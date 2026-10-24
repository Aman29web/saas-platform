import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { EmailQueueService, type InviteEmailPayload } from "./email-queue.service";

export const EMAIL_QUEUE_NAME = "email";
export const INVITE_EMAIL_JOB = "invite";

@Injectable()
export class BullEmailQueueService extends EmailQueueService {
  constructor(@InjectQueue(EMAIL_QUEUE_NAME) private readonly queue: Queue) {
    super();
  }

  async enqueueInviteEmail(payload: InviteEmailPayload): Promise<void> {
    await this.queue.add(INVITE_EMAIL_JOB, payload, {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    });
  }
}
