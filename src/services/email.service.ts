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

// The action has already happened, so a failed email is reported to the admin, not thrown.
async function sendNotice(message: Parameters<typeof send>[0]): Promise<boolean> {
  if (!isEmailConfigured()) return false;
  try {
    await send(message);
    return true;
  } catch (err) {
    console.error(`Email failed: ${(err as Error).name}`);
    return false;
  }
}

export function notifyAccountDeleted(to: string): Promise<boolean> {
  return sendNotice({
    to,
    subject: 'Your Moneystrait account has been deleted',
    text: 'Your Moneystrait account has been deleted by an admin. You can no longer log in with it.',
    html: '<p>Your Moneystrait account has been deleted by an admin. You can no longer log in with it.</p>',
  });
}

// Says only that something is needed: the question itself stays behind the login.
export function notifyInformationRequest(to: string): Promise<boolean> {
  const link = `${env.FRONTEND_ORIGIN}/account`;
  return sendNotice({
    to,
    subject: 'We need more information for your Moneystrait application',
    text: `We need a little more information to review your application. Log in to answer: ${link}`,
    html: `<p>We need a little more information to review your application.</p><p><a href="${link}">Log in to answer</a>.</p>`,
  });
}
