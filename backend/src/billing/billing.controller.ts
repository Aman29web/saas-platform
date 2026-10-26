import { Body, Controller, Get, Post, UseGuards, UseInterceptors } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { TenantContextGuard } from "../tenancy/tenant-context.guard";
import { TenantContextInterceptor } from "../tenancy/tenant-context.interceptor";
import { RequirePermission } from "../rbac/require-permission.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { BillingService } from "./billing.service";
import { SubscriptionsService } from "./subscriptions.service";
import {
  checkoutSchema,
  changePlanSchema,
  cancelSchema,
  type CheckoutDto,
  type ChangePlanDto,
  type CancelDto,
} from "./dto/billing.dto";

@Controller("billing")
@UseGuards(TenantContextGuard)
@UseInterceptors(TenantContextInterceptor)
@RequirePermission("org:billing:manage")
@Throttle({ default: { limit: 20, ttl: 60_000 } })
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  @Get("subscription")
  getSubscription() {
    return this.subscriptionsService.getForActiveOrgOrThrow();
  }

  @Post("checkout")
  checkout(@Body(new ZodValidationPipe(checkoutSchema)) dto: CheckoutDto) {
    return this.billingService.createCheckoutSession(dto.plan);
  }

  @Post("portal")
  portal() {
    return this.billingService.createPortalSession();
  }

  @Post("change-plan")
  changePlan(@Body(new ZodValidationPipe(changePlanSchema)) dto: ChangePlanDto) {
    return this.billingService.changePlan(dto.plan);
  }

  @Post("cancel")
  cancel(@Body(new ZodValidationPipe(cancelSchema)) dto: CancelDto) {
    return this.billingService.cancel(dto.atPeriodEnd);
  }
}
