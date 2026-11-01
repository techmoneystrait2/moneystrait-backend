import { describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { googleAudiences } from '../src/services/google.service';

describe('Google client IDs', () => {
  it('uses the website ID alone by default', () => {
    env.GOOGLE_MOBILE_CLIENT_IDS = undefined;
    expect(googleAudiences()).toEqual(['test-client-id']);
  });

  it('adds the app IDs, ignoring spaces and blanks', () => {
    env.GOOGLE_MOBILE_CLIENT_IDS = ' ios-id , android-id,, ';
    expect(googleAudiences()).toEqual(['test-client-id', 'ios-id', 'android-id']);
    env.GOOGLE_MOBILE_CLIENT_IDS = undefined;
  });
});
