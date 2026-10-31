import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env';

export interface GoogleProfile {
  googleId: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

const client = new OAuth2Client(env.GOOGLE_CLIENT_ID);

// Checks the ID token's signature, expiry, issuer and audience. Returns null if it fails.
export async function verifyGoogleCredential(credential: string): Promise<GoogleProfile | null> {
  try {
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) return null;
    return {
      googleId: payload.sub,
      email: payload.email.toLowerCase(),
      emailVerified: payload.email_verified === true,
      name: payload.name ?? payload.email,
    };
  } catch (err) {
    // The text before any detail only: the rest can contain the token's personal data.
    const reason = (err as Error).message.split(/[,:]/)[0]?.slice(0, 60);
    console.warn(`Google token rejected: ${reason}`);
    return null;
  }
}
