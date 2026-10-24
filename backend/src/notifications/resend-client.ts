import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Resend } from "resend";
import type { ApiEnv } from "../config/env.schema";

/**
 * Thin wrapper so the processor doesn't construct the SDK client itself.
 * With no RESEND_API_KEY configured (local dev without an account), sends
 * are logged and skipped instead of throwing — the rest of the invite flow
 * (token, membership, DB state) works identically either way.
 */
@Injectable()
export class ResendClient {
  private readonly logger = new Logger(ResendClient.name);
  private readonly client: Resend | null;
  private readonly from: string;

  constructor(config: ConfigService<ApiEnv, true>) {
    const apiKey = config.get("RESEND_API_KEY", { infer: true });
    this.client = apiKey ? new Resend(apiKey) : null;
    this.from = config.get("EMAIL_FROM", { infer: true });
  }

  async send(params: { to: string; subject: string; html: string }): Promise<void> {
    if (!this.client) {
      this.logger.warn(`RESEND_API_KEY not set — skipping email to ${params.to}: "${params.subject}"`);
      return;
    }
    await this.client.emails.send({ from: this.from, to: params.to, subject: params.subject, html: params.html });
  }
}
