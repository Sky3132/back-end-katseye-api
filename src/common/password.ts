import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(scryptCallback);

const SCRYPT_PREFIX = 'scrypt$';
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_KEY_BYTES = 64;

export function isHashedPassword(value: string): boolean {
  return value.startsWith(SCRYPT_PREFIX);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const derivedKey = (await scrypt(password, salt, SCRYPT_KEY_BYTES)) as Buffer;
  return `${SCRYPT_PREFIX}${salt.toString('base64')}$${derivedKey.toString('base64')}`;
}

export async function verifyPassword(
  password: string,
  storedPassword: string,
): Promise<boolean> {
  if (!isHashedPassword(storedPassword)) {
    const left = Buffer.from(password);
    const right = Buffer.from(storedPassword);
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  }

  const remainder = storedPassword.slice(SCRYPT_PREFIX.length);
  const [saltBase64, hashBase64] = remainder.split('$');
  if (!saltBase64 || !hashBase64) return false;

  let salt: Buffer;
  let expectedHash: Buffer;
  try {
    salt = Buffer.from(saltBase64, 'base64');
    expectedHash = Buffer.from(hashBase64, 'base64');
  } catch {
    return false;
  }

  const derivedKey = (await scrypt(password, salt, expectedHash.length)) as Buffer;
  if (derivedKey.length !== expectedHash.length) return false;
  return timingSafeEqual(derivedKey, expectedHash);
}

