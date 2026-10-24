import { Global, Module, type Provider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Stripe from "stripe";
import type { ApiEnv } from "../config/env.schema";

export const STRIPE_CLIENT = "STRIPE_CLIENT";

const stripeClientProvider: Provider = {
  provide: STRIPE_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService<ApiEnv, true>): Stripe => {
    // No key configured (local dev without a Stripe account) still
    // constructs a client — it just fails naturally, with a clear Stripe
    // API error, the first time a real call is attempted. Mirrors the
    // ResendClient dev fallback, but there's no cheap no-op for "create a
    // real payment session," so there's nothing sensible to skip to.
    const key = config.get("STRIPE_SECRET_KEY", { infer: true }) ?? "sk_test_not_configured";
    return new Stripe(key, { apiVersion: "2025-02-24.acacia" });
  },
};

@Global()
@Module({
  providers: [stripeClientProvider],
  exports: [STRIPE_CLIENT],
})
export class StripeModule {}
