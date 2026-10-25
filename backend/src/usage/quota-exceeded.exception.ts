import { ForbiddenException } from "@nestjs/common";
import type { UsageMetric } from "../common/enums";

export class QuotaExceededException extends ForbiddenException {
  constructor(metric: UsageMetric, quota: number) {
    super(`Quota exceeded for '${metric}': plan limit is ${quota}. Upgrade to increase it.`);
  }
}
