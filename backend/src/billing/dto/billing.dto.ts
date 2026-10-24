import { z } from "zod";

const paidPlanSchema = z.enum(["pro", "business"]);

export const checkoutSchema = z.object({ plan: paidPlanSchema });
export type CheckoutDto = z.infer<typeof checkoutSchema>;

export const changePlanSchema = z.object({ plan: paidPlanSchema });
export type ChangePlanDto = z.infer<typeof changePlanSchema>;

export const cancelSchema = z.object({ atPeriodEnd: z.boolean().default(true) });
export type CancelDto = z.infer<typeof cancelSchema>;
