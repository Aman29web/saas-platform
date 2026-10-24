import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { AuthenticatedUser } from "./auth.guard";

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthenticatedUser => {
  const request = ctx.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>();
  return request.user;
});
