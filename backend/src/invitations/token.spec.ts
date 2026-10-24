import { generateInviteToken, hashToken } from "./token";

describe("invite token", () => {
  it("generates a high-entropy raw token distinct from its hash", () => {
    const { rawToken, tokenHash } = generateInviteToken();
    expect(rawToken).toHaveLength(64);
    expect(tokenHash).toHaveLength(64);
    expect(rawToken).not.toBe(tokenHash);
  });

  it("hashing the same raw token twice is deterministic", () => {
    const { rawToken, tokenHash } = generateInviteToken();
    expect(hashToken(rawToken)).toBe(tokenHash);
  });

  it("two generated tokens never collide", () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a.rawToken).not.toBe(b.rawToken);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });
});
