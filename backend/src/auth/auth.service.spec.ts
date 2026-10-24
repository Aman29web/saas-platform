import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { Types } from "mongoose";
import * as argon2 from "argon2";
import { AuthService } from "./auth.service";

describe("AuthService", () => {
  const userId = new Types.ObjectId();
  const orgId = new Types.ObjectId();
  const tokenId = new Types.ObjectId();

  const baseUser = {
    _id: userId,
    email: "ada@example.com",
    name: "Ada",
    passwordHash: "",
  };

  function buildService() {
    const connection = {
      startSession: jest.fn(),
    };
    const usersService = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
    };
    const organizationsService = { create: jest.fn() };
    const membershipsService = { create: jest.fn() };
    const tokensService = {
      signAccessToken: jest.fn().mockResolvedValue("access-token"),
      signRefreshToken: jest.fn().mockResolvedValue("refresh-token"),
      verifyRefreshToken: jest.fn(),
      getRefreshTtlMs: jest.fn().mockReturnValue(1000 * 60),
    };
    const refreshTokensService = {
      createPlaceholder: jest.fn(),
      setTokenHash: jest.fn(),
      findById: jest.fn(),
      revoke: jest.fn(),
      revokeAllForUser: jest.fn(),
      verifyMatches: jest.fn(),
    };

    const service = new AuthService(
      connection as never,
      usersService as never,
      organizationsService as never,
      membershipsService as never,
      tokensService as never,
      refreshTokensService as never,
    );

    return { service, connection, usersService, organizationsService, membershipsService, tokensService, refreshTokensService };
  }

  describe("signup", () => {
    it("rejects a duplicate email before opening a transaction", async () => {
      const { service, usersService, connection } = buildService();
      usersService.findByEmail.mockResolvedValue(baseUser);

      await expect(
        service.signup({ name: "Ada", email: "ada@example.com", password: "password123", orgName: "Org" }),
      ).rejects.toThrow(ConflictException);
      expect(connection.startSession).not.toHaveBeenCalled();
    });

    it("creates user, org, and membership inside one transaction, then issues tokens", async () => {
      const { service, usersService, organizationsService, membershipsService, refreshTokensService, connection } =
        buildService();
      usersService.findByEmail.mockResolvedValueOnce(null).mockResolvedValue(null);
      usersService.create.mockResolvedValue(baseUser);
      usersService.findById.mockResolvedValue(baseUser);
      organizationsService.create.mockResolvedValue({ _id: orgId, name: "Org", slug: "org" });
      membershipsService.create.mockResolvedValue({});
      refreshTokensService.createPlaceholder.mockResolvedValue({ _id: tokenId });

      const session = {
        withTransaction: jest.fn(async (fn: () => Promise<unknown>) => fn()),
        endSession: jest.fn(),
      };
      connection.startSession.mockResolvedValue(session);

      const result = await service.signup({
        name: "Ada",
        email: "ada@example.com",
        password: "password123",
        orgName: "Org",
      });

      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: "ada@example.com", name: "Ada" }),
        session,
      );
      expect(organizationsService.create).toHaveBeenCalledWith({ name: "Org", ownerId: userId }, session);
      expect(membershipsService.create).toHaveBeenCalledWith(
        { userId, orgId, role: "owner" },
        session,
      );
      expect(result.tokens.accessToken).toBe("access-token");
      expect(session.endSession).toHaveBeenCalled();
    });
  });

  describe("login", () => {
    it("rejects an unknown email without revealing which part was wrong", async () => {
      const { service, usersService } = buildService();
      usersService.findByEmail.mockResolvedValue(null);

      await expect(service.login({ email: "nobody@example.com", password: "x" })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("rejects an incorrect password", async () => {
      const { service, usersService } = buildService();
      const passwordHash = await argon2.hash("correct-password");
      usersService.findByEmail.mockResolvedValue({ ...baseUser, passwordHash });

      await expect(service.login({ email: baseUser.email, password: "wrong" })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("issues tokens on a correct password", async () => {
      const { service, usersService, refreshTokensService } = buildService();
      const passwordHash = await argon2.hash("correct-password");
      usersService.findByEmail.mockResolvedValue({ ...baseUser, passwordHash });
      usersService.findById.mockResolvedValue(baseUser);
      refreshTokensService.createPlaceholder.mockResolvedValue({ _id: tokenId });

      const result = await service.login({ email: baseUser.email, password: "correct-password" });
      expect(result.tokens.accessToken).toBe("access-token");
      expect(result.tokens.refreshToken).toBe("refresh-token");
    });
  });

  describe("refresh", () => {
    it("rejects an unparseable/expired token", async () => {
      const { service, tokensService } = buildService();
      tokensService.verifyRefreshToken.mockRejectedValue(new Error("bad token"));

      await expect(service.refresh("garbage")).rejects.toThrow(UnauthorizedException);
    });

    it("detects reuse of an already-revoked token and revokes the whole session set", async () => {
      const { service, tokensService, refreshTokensService } = buildService();
      tokensService.verifyRefreshToken.mockResolvedValue({ sub: userId.toString(), jti: tokenId.toString() });
      refreshTokensService.findById.mockResolvedValue({
        _id: tokenId,
        userId,
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 10_000),
      });

      await expect(service.refresh("old-token")).rejects.toThrow(UnauthorizedException);
      expect(refreshTokensService.revokeAllForUser).toHaveBeenCalledWith(userId);
    });

    it("rejects an expired-but-unrevoked token", async () => {
      const { service, tokensService, refreshTokensService } = buildService();
      tokensService.verifyRefreshToken.mockResolvedValue({ sub: userId.toString(), jti: tokenId.toString() });
      refreshTokensService.findById.mockResolvedValue({
        _id: tokenId,
        userId,
        revokedAt: undefined,
        expiresAt: new Date(Date.now() - 10_000),
      });

      await expect(service.refresh("expired-token")).rejects.toThrow(UnauthorizedException);
    });

    it("rotates a valid token: revokes the old one and issues a new pair", async () => {
      const { service, tokensService, refreshTokensService, usersService } = buildService();
      tokensService.verifyRefreshToken.mockResolvedValue({ sub: userId.toString(), jti: tokenId.toString() });
      refreshTokensService.findById.mockResolvedValue({
        _id: tokenId,
        userId,
        revokedAt: undefined,
        expiresAt: new Date(Date.now() + 10_000),
      });
      refreshTokensService.verifyMatches.mockResolvedValue(true);
      usersService.findById.mockResolvedValue(baseUser);
      refreshTokensService.createPlaceholder.mockResolvedValue({ _id: new Types.ObjectId() });

      const tokens = await service.refresh("valid-token");
      expect(tokens.accessToken).toBe("access-token");
      expect(refreshTokensService.revoke).toHaveBeenCalledWith(tokenId);
    });
  });

  describe("logout", () => {
    it("is a no-op when no refresh token cookie is present", async () => {
      const { service, refreshTokensService } = buildService();
      await service.logout(undefined);
      expect(refreshTokensService.revoke).not.toHaveBeenCalled();
    });

    it("revokes the matching refresh token record", async () => {
      const { service, tokensService, refreshTokensService } = buildService();
      tokensService.verifyRefreshToken.mockResolvedValue({ sub: userId.toString(), jti: tokenId.toString() });
      refreshTokensService.findById.mockResolvedValue({ _id: tokenId, revokedAt: undefined });

      await service.logout("some-token");
      expect(refreshTokensService.revoke).toHaveBeenCalledWith(tokenId);
    });

    it("swallows verification errors silently", async () => {
      const { service, tokensService, refreshTokensService } = buildService();
      tokensService.verifyRefreshToken.mockRejectedValue(new Error("bad"));

      await expect(service.logout("garbage")).resolves.toBeUndefined();
      expect(refreshTokensService.revoke).not.toHaveBeenCalled();
    });
  });
});
