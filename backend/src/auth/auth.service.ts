import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection, Types } from "mongoose";
import * as argon2 from "argon2";
import { UsersService } from "../users/users.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { MembershipsService } from "../memberships/memberships.service";
import { TokensService } from "./tokens.service";
import { RefreshTokensService } from "./refresh-tokens.service";
import type { SignupDto, LoginDto } from "./dto/auth.dto";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly usersService: UsersService,
    private readonly organizationsService: OrganizationsService,
    private readonly membershipsService: MembershipsService,
    private readonly tokensService: TokensService,
    private readonly refreshTokensService: RefreshTokensService,
  ) {}

  async signup(dto: SignupDto) {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) throw new ConflictException("An account with this email already exists");

    const session = await this.connection.startSession();
    try {
      const { user, org } = await session.withTransaction(async () => {
        const passwordHash = await argon2.hash(dto.password);
        const user = await this.usersService.create(
          { email: dto.email, name: dto.name, passwordHash },
          session,
        );
        const org = await this.organizationsService.create(
          { name: dto.orgName, ownerId: user._id },
          session,
        );
        await this.membershipsService.create(
          { userId: user._id, orgId: org._id, role: "owner" },
          session,
        );
        return { user, org };
      });

      const tokens = await this.issueTokens(user._id);
      return { user, org, tokens };
    } finally {
      await session.endSession();
    }
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email, { withPasswordHash: true });
    if (!user) throw new UnauthorizedException("Invalid email or password");

    const valid = await argon2.verify(user.passwordHash, dto.password);
    if (!valid) throw new UnauthorizedException("Invalid email or password");

    const tokens = await this.issueTokens(user._id);
    return { user, tokens };
  }

  async refresh(rawRefreshToken: string): Promise<AuthTokens> {
    let payload;
    try {
      payload = await this.tokensService.verifyRefreshToken(rawRefreshToken);
    } catch {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    const existing = await this.refreshTokensService.findById(payload.jti);
    if (!existing) throw new UnauthorizedException("Refresh token not recognized");

    if (existing.revokedAt) {
      await this.refreshTokensService.revokeAllForUser(existing.userId);
      throw new UnauthorizedException("Refresh token reuse detected; all sessions revoked");
    }

    if (existing.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException("Refresh token expired");
    }

    const matches = await this.refreshTokensService.verifyMatches(existing, rawRefreshToken);
    if (!matches) throw new UnauthorizedException("Refresh token mismatch");

    const tokens = await this.issueTokens(existing.userId);
    await this.refreshTokensService.revoke(existing._id);
    return tokens;
  }

  async logout(rawRefreshToken: string | undefined) {
    if (!rawRefreshToken) return;
    try {
      const payload = await this.tokensService.verifyRefreshToken(rawRefreshToken);
      const existing = await this.refreshTokensService.findById(payload.jti);
      if (existing && !existing.revokedAt) {
        await this.refreshTokensService.revoke(existing._id);
      }
    } catch {
      // token already invalid/expired — nothing to revoke
    }
  }

  private async issueTokens(userId: Types.ObjectId): Promise<AuthTokens> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException("User no longer exists");

    const accessToken = await this.tokensService.signAccessToken({
      sub: user._id.toString(),
      email: user.email,
    });

    const expiresAt = new Date(Date.now() + this.tokensService.getRefreshTtlMs());
    const placeholder = await this.refreshTokensService.createPlaceholder(user._id, expiresAt);
    const refreshToken = await this.tokensService.signRefreshToken({
      sub: user._id.toString(),
      jti: placeholder._id.toString(),
    });
    await this.refreshTokensService.setTokenHash(placeholder._id, refreshToken);

    return { accessToken, refreshToken };
  }
}
