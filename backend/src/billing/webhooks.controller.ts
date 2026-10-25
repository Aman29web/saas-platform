import { BadRequestException, Controller, HttpCode, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { WebhooksService } from "./webhooks.service";

@Controller("billing/webhook")
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post()
  @HttpCode(200)
  async handle(@Req() req: Request & { rawBody?: Buffer }) {
    const signature = req.headers["stripe-signature"];
    if (!signature || typeof signature !== "string") {
      throw new BadRequestException("Missing stripe-signature header");
    }
    if (!req.rawBody) {
      throw new BadRequestException("Raw body unavailable — check rawBody is enabled on the Nest app");
    }

    const event = this.webhooksService.verifyAndParse(req.rawBody, signature);
    await this.webhooksService.handleEvent(event, req.rawBody);
    return { received: true };
  }
}
