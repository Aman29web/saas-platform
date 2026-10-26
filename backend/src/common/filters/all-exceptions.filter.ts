import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Response } from "express";

/**
 * Catches everything Nest's own exception handling would otherwise let
 * through unchanged: a thrown HttpException (ForbiddenException,
 * NotFoundException, ...) still gets its normal status/message, but a raw
 * Error (a bug, not a deliberate rejection) is logged with full detail and
 * returned to the client as a generic 500 with no internal detail leaked.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("UnhandledException");

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    this.logger.error(
      exception instanceof Error ? exception.message : "Unknown error",
      exception instanceof Error ? exception.stack : undefined,
    );

    // Hook point for Sentry or any other error tracker: wire it in by
    // calling its capture function here when SENTRY_DSN (or equivalent) is
    // configured. Left as a no-op rather than an unused dependency, since
    // there's no account to actually send to in this environment.
    reportToErrorTracker();

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal server error",
    });
  }
}

function reportToErrorTracker(): void {
  // Intentionally empty — see the comment above.
}
