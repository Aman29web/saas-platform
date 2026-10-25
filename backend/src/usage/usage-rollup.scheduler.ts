import { Injectable, type OnModuleInit } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { USAGE_ROLLUP_JOB, USAGE_ROLLUP_QUEUE_NAME } from "./usage-rollup.processor";

@Injectable()
export class UsageRollupScheduler implements OnModuleInit {
  constructor(@InjectQueue(USAGE_ROLLUP_QUEUE_NAME) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    // BullMQ dedups repeatable jobs by {name, pattern}, so this is safe to
    // run on every boot without piling up duplicate schedules.
    await this.queue.add(USAGE_ROLLUP_JOB, {}, { repeat: { pattern: "0 * * * *" } });
  }
}
