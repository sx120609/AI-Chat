import { randomBytes, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;

  return `scrypt$${salt}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [scheme, salt, storedKey] = encoded.split("$");

  if (scheme !== "scrypt" || !salt || !storedKey) {
    return false;
  }

  const key = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  const stored = Buffer.from(storedKey, "hex");

  if (stored.length !== key.length) {
    return false;
  }

  return timingSafeEqual(stored, key);
}
