import bcrypt from 'bcrypt';

const BCRYPT_ROUNDS = 12;

// Compared when no password exists, so response time doesn't reveal which accounts exist.
const DUMMY_HASH = bcrypt.hashSync('moneystrait-timing-placeholder', BCRYPT_ROUNDS);

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function checkPassword(password: string, hash: string | undefined): Promise<boolean> {
  return bcrypt.compare(password, hash ?? DUMMY_HASH);
}
