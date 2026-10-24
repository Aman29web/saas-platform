import { BadRequestException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { Plan } from "../common/enums";
import type { ApiEnv } from "../config/env.schema";

/**
 * `free` deliberately has no Stripe price — it's not a subscription at
 * all, just the org's default state. Checkout/change-plan reject it.
 */
export function priceIdForPlan(plan: Plan, config: ConfigService<ApiEnv, true>): string {
  if (plan === "pro") {
    const priceId = config.get("STRIPE_PRICE_PRO", { infer: true });
    if (!priceId) throw new BadRequestException("STRIPE_PRICE_PRO is not configured");
    return priceId;
  }
  if (plan === "business") {
    const priceId = config.get("STRIPE_PRICE_BUSINESS", { infer: true });
    if (!priceId) throw new BadRequestException("STRIPE_PRICE_BUSINESS is not configured");
    return priceId;
  }
  throw new BadRequestException("The free plan has no Stripe price — cancel the subscription instead");
}

export function planForPriceId(priceId: string, config: ConfigService<ApiEnv, true>): Plan {
  if (priceId === config.get("STRIPE_PRICE_PRO", { infer: true })) return "pro";
  if (priceId === config.get("STRIPE_PRICE_BUSINESS", { infer: true })) return "business";
  throw new Error(`Unrecognized Stripe price id: ${priceId}`);
}
