import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import type { ApiEnv } from "../config/env.schema";

export interface AccessTokenPayload {
  sub: string;
  email: string;
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
}

@Injectable()
export class TokensService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService<ApiEnv, true>,
  ) {}

  signAccessToken(payload: AccessTokenPayload): Promise<string> {
    return this.jwtService.signAsync(payload, {
      secret: this.config.get("JWT_ACCESS_SECRET", { infer: true }),
      expiresIn: this.config.get("JWT_ACCESS_TTL", { infer: true }),
    });
  }

  signRefreshToken(payload: RefreshTokenPayload): Promise<string> {
    return this.jwtService.signAsync(payload, {
      secret: this.config.get("JWT_REFRESH_SECRET", { infer: true }),
      expiresIn: this.config.get("JWT_REFRESH_TTL", { infer: true }),
    });
  }

  verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    return this.jwtService.verifyAsync<AccessTokenPayload>(token, {
      secret: this.config.get("JWT_ACCESS_SECRET", { infer: true }),
    });
  }

  verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    return this.jwtService.verifyAsync<RefreshTokenPayload>(token, {
      secret: this.config.get("JWT_REFRESH_SECRET", { infer: true }),
    });
  }

  getRefreshTtlMs(): number {
    const ttl = this.config.get("JWT_REFRESH_TTL", { infer: true });
    return parseDurationToMs(ttl);
  }
}

function parseDurationToMs(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) throw new Error(`Invalid duration format: ${duration}`);
  const value = Number(match[1]);
  const unit = match[2];
  const unitMs: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * unitMs[unit]!;
}
