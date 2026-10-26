import { Body, Controller, HttpCode, Post, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import type { Request, Response } from "express";
import { ImpersonationService } from "./impersonation.service";
import { restoreAdminCookies } from "../auth/cookies";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { ApiEnv } from "../config/env.schema";

const exitImpersonationSchema = z.object({ orgId: z.string().optional() });
type ExitImpersonationDto = z.infer<typeof exitImpersonationSchema>;

/**
 * Deliberately NOT gated by AuthGuard/PlatformAdminGuard: while
 * impersonating, the ACTIVE access_token cookie authenticates as the
 * impersonated user, not the admin — a guard checking "is the current
 * session a platform admin" would reject the admin's own request to stop
 * impersonating them. Admin identity here is verified from the stashed
 * admin_access_token cookie instead (see ImpersonationService.endImpersonation),
 * which is what actually proves this caller was a real admin who started
 * a real impersonation session, not a forgeable claim.
 */
@Controller("admin/impersonate")
export class ImpersonationExitController {
  constructor(
    private readonly impersonationService: ImpersonationService,
    private readonly config: ConfigService<ApiEnv, true>,
  ) {}

  @Post("exit")
  @HttpCode(200)
  async exit(
    @Body(new ZodValidationPipe(exitImpersonationSchema)) body: ExitImpersonationDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const adminAccessTokenCookie = req.cookies?.admin_access_token as string | undefined;
    const restored = await this.impersonationService.endImpersonation(adminAccessTokenCookie, body.orgId, req.ip);
    restoreAdminCookies(res, this.config, restored);
    return { success: true };
  }
}
