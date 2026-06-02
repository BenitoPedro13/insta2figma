import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly transporter: nodemailer.Transporter | null;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    const user = config.get<string>('SMTP_USER')?.trim();
    const pass = config.get<string>('SMTP_PASS')?.trim();
    this.from = config.get<string>('SMTP_FROM')?.trim() ?? user ?? 'noreply@insta2figma.app';

    if (user && pass) {
      this.transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: { user, pass },
      });
      console.info('[email] SMTP configurado via Gmail');
    } else {
      this.transporter = null;
      console.warn('[email] SMTP_USER / SMTP_PASS não definidos — emails desactivados');
    }
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
