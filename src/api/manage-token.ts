import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Run ownership without accounts.
 *
 * Creating a run returns a manage token (shown once). Extending, listing,
 * unlisting and deleting require it. The server stores only the SHA-256
 * hash, so a stolen database does not hand over every run. Runs created
 * before tokens existed carry no hash and stay open — documented, and true
 * only of ancient test debris.
 */

export function newManageToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time comparison so token guessing is not measurable. */
export function verifyToken(token: string, hash: string): boolean {
  if (typeof token !== "string" || token.length === 0) return false;
  const a = Buffer.from(hashToken(token), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
