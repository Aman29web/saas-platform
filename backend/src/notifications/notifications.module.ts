import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { EMAIL_QUEUE_NAME } from "./bull-email-queue.service";
import { BullEmailQueueService } from "./bull-email-queue.service";
import { EmailQueueService } from "./email-queue.service";
import { EmailProcessor } from "./email.processor";
import { ResendClient } from "./resend-client";

@Module({
  imports: [BullModule.registerQueue({ name: EMAIL_QUEUE_NAME })],
  providers: [
    ResendClient,
    EmailProcessor,
    { provide: EmailQueueService, useClass: BullEmailQueueService },
  ],
  exports: [EmailQueueService],
})
export class NotificationsModule {}
