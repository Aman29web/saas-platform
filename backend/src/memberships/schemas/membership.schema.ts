import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Schema as MongooseSchema, Types } from "mongoose";
import { ROLES, MEMBERSHIP_STATUSES, type Role, type MembershipStatus } from "../../common/enums";

@Schema({ timestamps: true, collection: "memberships" })
export class Membership {
  _id!: Types.ObjectId;

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, ref: "User", index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, ref: "Organization", index: true })
  orgId!: Types.ObjectId;

  @Prop({ required: true, enum: ROLES })
  role!: Role;

  @Prop({ required: true, enum: MEMBERSHIP_STATUSES, default: "active" })
  status!: MembershipStatus;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: "User" })
  invitedBy?: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export type MembershipDocument = Membership & Document;
export const MembershipSchema = SchemaFactory.createForClass(Membership);
MembershipSchema.index({ orgId: 1, userId: 1 }, { unique: true });
