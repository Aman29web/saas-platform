import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types } from "mongoose";

/**
 * Deliberately NOT tenant-scoped: Stripe calls this endpoint with no
 * authentication and no org context at all — the whole point of this
 * collection is to dedupe before we even know which org (if any) an event
 * belongs to.
 */
@Schema({ timestamps: false, collection: "webhook_events" })
export class WebhookEvent {
  _id!: Types.ObjectId;

  @Prop({ required: true, unique: true })
  stripeEventId!: string;

  @Prop({ required: true })
  type!: string;

  @Prop({ required: true })
  processedAt!: Date;

  @Prop({ required: true })
  payloadHash!: string;
}

export type WebhookEventDocument = WebhookEvent & Document;
export const WebhookEventSchema = SchemaFactory.createForClass(WebhookEvent);
