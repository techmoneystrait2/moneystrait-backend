import nodemailer from 'nodemailer';
import { env } from '../config/env';

export function isEmailConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD && env.EMAIL_FROM);
}

function send(message: { to: string; subject: string; text: string; html: string }) {
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
  });
  return transport.sendMail({ from: env.EMAIL_FROM, ...message });
}

export async function sendPasswordResetCode(to: string, code: string, minutes: number): Promise<void> {
  const link = `${env.FRONTEND_ORIGIN}/forgot-password`;
  await send({
    to,
    subject: 'Your Moneystrait password reset code',
    text: [
      `Your password reset code is ${code}.`,
      '',
      `It expires in ${minutes} minutes. Enter it here: ${link}`,
      '',
      'If you didn’t ask for this, you can ignore this email. Your password has not changed.',
      'We will never ask you for this code.',
    ].join('\n'),
    html: `<p>Your password reset code is:</p>
<p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p>
<p>It expires in ${minutes} minutes. <a href="${link}">Enter it here</a>.</p>
<p>If you didn’t ask for this, you can ignore this email. Your password has not changed.</p>
<p>We will never ask you for this code.</p>`,
  });
}

// The account is already gone by now, so a failed email is reported to the admin, not thrown.
export async function notifyAccountDeleted(to: string): Promise<boolean> {
  if (!isEmailConfigured()) return false;
  try {
    await send({
      to,
      subject: 'Your Moneystrait account has been deleted',
      text: 'Your Moneystrait account has been deleted by an admin. You can no longer log in with it.',
      html: '<p>Your Moneystrait account has been deleted by an admin. You can no longer log in with it.</p>',
    });
    return true;
  } catch (err) {
    console.error(`Account deleted email failed: ${(err as Error).name}`);
    return false;
  }
}
