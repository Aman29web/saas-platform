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

  res.cookie("access_token", tokens.accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    domain,
    maxAge: 15 * 60 * 1000,
  });

  res.cookie("refresh_token", tokens.refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
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
