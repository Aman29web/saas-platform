import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { TokensService } from "./tokens.service";
import { UsersService } from "../users/users.service";

export interface AuthenticatedUser {
  id: string;
  email: string;
  isPlatformAdmin: boolean;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly tokensService: TokensService,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>();
    const token = request.cookies?.access_token as string | undefined;
    if (!token) throw new UnauthorizedException("Missing access token");

    let payload;
    try {
      payload = await this.tokensService.verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException("Invalid or expired access token");
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user) throw new UnauthorizedException("User no longer exists");

    request.user = { id: user._id.toString(), email: user.email, isPlatformAdmin: user.isPlatformAdmin };
    return true;
  }
}
