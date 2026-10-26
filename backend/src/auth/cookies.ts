import type { Response } from "express";
import type { ConfigService } from "@nestjs/config";
import type { ApiEnv } from "../config/env.schema";

export function setAuthCookies(
  res: Response,
  config: ConfigService<ApiEnv, true>,
  tokens: { accessToken: string; refreshToken: string },
) {
  const isProd = config.get("NODE_ENV", { infer: true }) === "production";
  const domain = config.get("COOKIE_DOMAIN", { infer: true });
  // Frontend and API live on different origins in production (e.g. Vercel +
  // Railway), so cookies must be SameSite=None to be sent on cross-site
  // fetch/XHR — browsers require Secure whenever SameSite=None is used.
  const sameSite = isProd ? ("none" as const) : ("lax" as const);

  res.cookie("access_token", tokens.accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite,
    path: "/",
    domain,
    maxAge: 15 * 60 * 1000,
  });

  res.cookie("refresh_token", tokens.refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite,
    path: "/",
    domain,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookies(res: Response, config: ConfigService<ApiEnv, true>) {
  const domain = config.get("COOKIE_DOMAIN", { infer: true });
  res.clearCookie("access_token", { path: "/", domain });
  res.clearCookie("refresh_token", { path: "/", domain });
}

/**
 * Impersonation swaps `access_token` for a token scoped to the target
 * user, so the admin's own access token is stashed here first — "exit
 * impersonation" restores it rather than forcing the admin to log back in.
 * No refresh token is issued for the impersonation session itself: it is
 * bounded by its own short expiry, not refreshable indefinitely.
 */
export function setImpersonationCookies(
  res: Response,
  config: ConfigService<ApiEnv, true>,
  tokens: { adminAccessToken: string; impersonationAccessToken: string },
) {
  const isProd = config.get("NODE_ENV", { infer: true }) === "production";
  const domain = config.get("COOKIE_DOMAIN", { infer: true });
  const sameSite = isProd ? ("none" as const) : ("lax" as const);
  const cookieOpts = { httpOnly: true, secure: isProd, sameSite, path: "/", domain };

  res.cookie("admin_access_token", tokens.adminAccessToken, { ...cookieOpts, maxAge: 60 * 60 * 1000 });
  res.cookie("access_token", tokens.impersonationAccessToken, { ...cookieOpts, maxAge: 15 * 60 * 1000 });
}

export function restoreAdminCookies(res: Response, config: ConfigService<ApiEnv, true>, adminAccessToken: string) {
  const isProd = config.get("NODE_ENV", { infer: true }) === "production";
  const domain = config.get("COOKIE_DOMAIN", { infer: true });
  const sameSite = isProd ? ("none" as const) : ("lax" as const);
  const cookieOpts = { httpOnly: true, secure: isProd, sameSite, path: "/", domain };

  res.cookie("access_token", adminAccessToken, { ...cookieOpts, maxAge: 15 * 60 * 1000 });
  res.clearCookie("admin_access_token", { path: "/", domain });
}
