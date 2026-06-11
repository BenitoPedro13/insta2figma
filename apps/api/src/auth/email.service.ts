import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';

@Injectable()
export class EmailService implements OnModuleInit {
  private gmail: ReturnType<typeof google.gmail> | null = null;
  private readonly from: string;
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly refreshToken: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.clientId = config.get<string>('GOOGLE_CLIENT_ID')?.trim();
    this.clientSecret = config.get<string>('GOOGLE_CLIENT_SECRET')?.trim();
    this.refreshToken = config.get<string>('GOOGLE_REFRESH_TOKEN')?.trim();
    this.from = config.get<string>('GMAIL_FROM')?.trim() ?? '';
  }

  onModuleInit(): void {
    if (!this.clientId || !this.clientSecret || !this.refreshToken) {
      console.warn('[email] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN não definidos — emails desactivados');
      return;
    }

    const auth = new google.auth.OAuth2(this.clientId, this.clientSecret);
    auth.setCredentials({ refresh_token: this.refreshToken });
    this.gmail = google.gmail({ version: 'v1', auth });
    console.info('[email] Gmail API configurada');
  }

  isConfigured(): boolean {
    return this.gmail !== null;
  }

  async sendMagicLink(to: string, link: string): Promise<void> {
    if (!this.gmail) {
      console.warn('[email] magic link não enviado (Gmail API não configurada):', link);
      return;
    }

    const from = this.from || to;
    const subject = 'Sign in to Insta2Figma';
    const html = `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#111">
        <h2 style="margin:0 0 8px">Sign in to Insta2Figma</h2>
        <p style="color:#555;margin:0 0 28px">Click the button below to sign in. This link expires in 15 minutes and can only be used once.</p>
        <a href="${link}"
           style="display:inline-block;background:#000;color:#fff;padding:13px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">
          Sign in
        </a>
        <p style="color:#999;font-size:12px;margin-top:32px">
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    `;

    const mime = [
      `From: Insta2Figma <${from}>`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      html,
    ].join('\r\n');

    const encoded = Buffer.from(mime).toString('base64url');

    await this.gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encoded },
    });

    console.info(`[email] magic link enviado para ${to}`);
  }

  async sendFeedback(input: {
    name: string;
    email: string;
    message: string;
    platform?: string | null;
  }): Promise<void> {
    if (!this.gmail) {
      console.warn('[email] feedback não enviado por email (Gmail API não configurada)');
      return;
    }

    const to =
      this.config.get<string>('FEEDBACK_EMAIL_TO')?.trim() || this.from;
    if (!to) {
      console.warn('[email] feedback não enviado — FEEDBACK_EMAIL_TO/GMAIL_FROM em falta');
      return;
    }

    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const subject = `[Insta2Figma] Feedback de ${input.name} (${input.platform ?? 'unknown'})`;
    const html = `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">
        <h2 style="margin:0 0 16px">Novo feedback</h2>
        <p style="margin:0 0 4px"><strong>Nome:</strong> ${esc(input.name)}</p>
        <p style="margin:0 0 4px"><strong>Email:</strong> ${esc(input.email)}</p>
        <p style="margin:0 0 16px"><strong>Plataforma:</strong> ${esc(input.platform ?? 'unknown')}</p>
        <p style="white-space:pre-wrap;background:#f5f5f5;border-radius:8px;padding:16px;margin:0">${esc(input.message)}</p>
      </div>
    `;

    const mime = [
      `From: Insta2Figma <${this.from || to}>`,
      `To: ${to}`,
      `Reply-To: ${input.email}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      html,
    ].join('\r\n');

    const encoded = Buffer.from(mime).toString('base64url');

    await this.gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encoded },
    });

    console.info(`[email] feedback de ${input.email} enviado para ${to}`);
  }
}
