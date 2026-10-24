import { randomBytes, createHash } from "crypto";

/**
 * Invite tokens are 256 bits of entropy, so a fast one-way hash (not
 * argon2) is fine for the lookup: brute-forcing the token from its hash is
 * infeasible regardless of hash speed, and argon2's deliberate slowness
 * only matters for low-entropy secrets like passwords.
 */
export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function generateInviteToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString("hex");
  return { rawToken, tokenHash: hashToken(rawToken) };
}
