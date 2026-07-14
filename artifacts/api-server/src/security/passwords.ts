import { createHash, randomBytes, scrypt, timingSafeEqual } from "crypto";

const SCRYPT_VERSION = 1;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_SALT_LENGTH = 16;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;

// Legacy SHA-256 compatibility only; never use this helper for new hashes.
function hashLegacyPassword(password: string): string {
  return createHash("sha256").update(password + "eys_salt_2024").digest("hex");
}

function deriveScryptKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEY_LENGTH, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: SCRYPT_MAX_MEMORY,
    }, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

function decodeCanonicalBase64(value: string): Buffer | null {
  if (value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const decoded = Buffer.from(value, "base64");
  return decoded.toString("base64") === value ? decoded : null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_LENGTH);
  const derivedKey = await deriveScryptKey(password, salt);
  return [
    "scrypt",
    `v=${SCRYPT_VERSION}`,
    `N=${SCRYPT_N}`,
    `r=${SCRYPT_R}`,
    `p=${SCRYPT_P}`,
    salt.toString("base64"),
    derivedKey.toString("base64"),
  ].join("$");
}

export function isLegacyPasswordHash(storedHash: string): boolean {
  return /^[a-f0-9]{64}$/i.test(storedHash);
}

export function needsPasswordRehash(storedHash: string): boolean {
  return isLegacyPasswordHash(storedHash);
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    if (isLegacyPasswordHash(storedHash)) {
      const expected = Buffer.from(storedHash, "hex");
      const actual = Buffer.from(hashLegacyPassword(password), "hex");
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    }

    const parts = storedHash.split("$");
    if (parts.length !== 7 ||
        parts[0] !== "scrypt" ||
        parts[1] !== `v=${SCRYPT_VERSION}` ||
        parts[2] !== `N=${SCRYPT_N}` ||
        parts[3] !== `r=${SCRYPT_R}` ||
        parts[4] !== `p=${SCRYPT_P}`) {
      return false;
    }

    const salt = decodeCanonicalBase64(parts[5]);
    const expected = decodeCanonicalBase64(parts[6]);
    if (!salt || salt.length !== SCRYPT_SALT_LENGTH || !expected || expected.length !== SCRYPT_KEY_LENGTH) {
      return false;
    }

    const actual = await deriveScryptKey(password, salt);
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
