import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { ResendClient } from "./resend-client";
import { EMAIL_QUEUE_NAME, INVITE_EMAIL_JOB } from "./bull-email-queue.service";
import type { InviteEmailPayload } from "./email-queue.service";

@Processor(EMAIL_QUEUE_NAME)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(private readonly resendClient: ResendClient) {
    super();
  }

  async process(job: Job<InviteEmailPayload>): Promise<void> {
    if (job.name !== INVITE_EMAIL_JOB) {
      this.logger.warn(`Unknown email job name: ${job.name}`);
      return;
    }

    const { to, orgName, inviterName, acceptUrl } = job.data;
    await this.resendClient.send({
      to,
      subject: `${inviterName} invited you to join ${orgName}`,
      html: `<p>${inviterName} invited you to join <strong>${orgName}</strong>.</p><p><a href="${acceptUrl}">Accept invitation</a></p><p>This link expires in 7 days.</p>`,
    });
  }
}
