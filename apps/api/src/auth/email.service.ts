import { resolve4 } from 'dns/promises';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

@Injectable()
export class EmailService implements OnModuleInit {
  private transporter: nodemailer.Transporter | null = null;
  private readonly from: string;
  private readonly user: string | undefined;
  private readonly pass: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.user = config.get<string>('SMTP_USER')?.trim();
    this.pass = config.get<string>('SMTP_PASS')?.trim();
    this.from = config.get<string>('SMTP_FROM')?.trim() ?? this.user ?? 'noreply@insta2figma.app';
  }

  async onModuleInit(): Promise<void> {
    if (!this.user || !this.pass) {
      console.warn('[email] SMTP_USER / SMTP_PASS não definidos — emails desactivados');
      return;
    }
    // Resolve smtp.gmail.com to IPv4 explicitly — Railway's DNS returns IPv6 first
    // which triggers ENETUNREACH since Railway doesn't support outbound IPv6.
    let host = 'smtp.gmail.com';
    try {
      const [ipv4] = await resolve4('smtp.gmail.com');
      host = ipv4;
      console.info(`[email] smtp.gmail.com resolvido para ${ipv4}`);
    } catch (e) {
      console.warn('[email] falha ao resolver smtp.gmail.com, usando hostname:', e);
    }

    const smtpOptions: SMTPTransport.Options = {
      host,
      port: 587,
      secure: false,
      tls: { servername: 'smtp.gmail.com' },
      auth: { user: this.user, pass: this.pass },
    };
    this.transporter = nodemailer.createTransport(smtpOptions);
    console.info('[email] SMTP configurado via Gmail');
  }

  isConfigured(): boolean {
    return this.transporter !== null;
  }

  async sendMagicLink(to: string, link: string): Promise<void> {
    if (!this.transporter) {
      console.warn('[email] magic link não enviado (SMTP não configurado):', link);
      return;
    }
    await this.transporter.sendMail({
      from: this.from,
      to,
      subject: 'Sign in to Insta2Figma',
      html: `
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
      `,
    });
  }
}
