import { Injectable } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';

@Injectable()
export class MailerService {
  private transporter: Transporter | null = null;

  private getTransporter() {
    if (this.transporter) return this.transporter;

    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT ?? 587);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !user || !pass) {
      return null;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });

    return this.transporter;
  }

  async sendMail(payload: { to: string; subject: string; html: string }) {
    const transporter = this.getTransporter();
    if (!transporter) {
      // eslint-disable-next-line no-console
      console.warn(
        'MailerService: SMTP not configured (set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS). Skipping email send.',
      );
      return;
    }

    const from =
      process.env.SMTP_FROM ??
      process.env.SMTP_USER ??
      'no-reply@katseye.local';

    await transporter.sendMail({
      from,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
    });
  }
}

