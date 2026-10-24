import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Schema as MongooseSchema, Types } from "mongoose";
import { PLANS, SUBSCRIPTION_STATUSES, type Plan, type SubscriptionStatus } from "../../common/enums";

@Schema({ timestamps: true, collection: "organizations" })
export class Organization {
  _id!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true, index: true })
  slug!: string;

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, ref: "User" })
  ownerId!: Types.ObjectId;

  @Prop()
  stripeCustomerId?: string;

  @Prop({ enum: PLANS, default: "free" })
  plan!: Plan;

  @Prop({ enum: SUBSCRIPTION_STATUSES, default: "active" })
  subscriptionStatus!: SubscriptionStatus;

  createdAt!: Date;
  updatedAt!: Date;
}

export type OrganizationDocument = Organization & Document;
export const OrganizationSchema = SchemaFactory.createForClass(Organization);
