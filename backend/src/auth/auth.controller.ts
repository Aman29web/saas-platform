import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service";
import { AuthGuard, type AuthenticatedUser } from "./auth.guard";
import { CurrentUser } from "./current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { signupSchema, loginSchema, type SignupDto, type LoginDto } from "./dto/auth.dto";
import { setAuthCookies, clearAuthCookies } from "./cookies";
import { MembershipsService } from "../memberships/memberships.service";
import type { ApiEnv } from "../config/env.schema";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly membershipsService: MembershipsService,
    private readonly config: ConfigService<ApiEnv, true>,
  ) {}

  // Stricter than the global default (100/min): credential-guessing and
  // mass-account-creation endpoints are exactly where per-IP rate limiting
  // earns its keep.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("signup")
  async signup(@Body(new ZodValidationPipe(signupSchema)) dto: SignupDto, @Res({ passthrough: true }) res: Response) {
    const { user, org, tokens } = await this.authService.signup(dto);
    setAuthCookies(res, this.config, tokens);
    return {
      user: { id: user._id.toString(), email: user.email, name: user.name },
      organization: { id: org._id.toString(), name: org.name, slug: org.slug },
    };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("login")
  @HttpCode(200)
  async login(@Body(new ZodValidationPipe(loginSchema)) dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { user, tokens } = await this.authService.login(dto);
    setAuthCookies(res, this.config, tokens);
    return { user: { id: user._id.toString(), email: user.email, name: user.name } };
  }

  @Post("refresh")
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.refresh_token as string | undefined;
    if (!refreshToken) throw new UnauthorizedException("Missing refresh token");

    const tokens = await this.authService.refresh(refreshToken);
    setAuthCookies(res, this.config, tokens);
    return { success: true };
  }

  @Post("logout")
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.refresh_token as string | undefined;
    await this.authService.logout(refreshToken);
    clearAuthCookies(res, this.config);
    return { success: true };
  }

  @Get("me")
  @UseGuards(AuthGuard)
  async me(@CurrentUser() user: AuthenticatedUser) {
    const memberships = await this.membershipsService.listByUser(user.id);
    return {
      user,
      memberships: memberships.map((m) => ({
        orgId: m.orgId,
        role: m.role,
      })),
    };
  }
}
