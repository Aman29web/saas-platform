import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Schema as MongooseSchema, Types } from "mongoose";
import { tenantScopePlugin } from "../../tenancy/tenant-scope.plugin";
import { ROLES, type Role } from "../../common/enums";

@Schema({ timestamps: true, collection: "invitations" })
export class Invitation {
  _id!: Types.ObjectId;

  // Stamped automatically by tenantScopePlugin — never set this by hand.
  @Prop({ required: true, index: true })
  tenantId!: string;

  @Prop({ required: true, lowercase: true, trim: true, index: true })
  email!: string;

  @Prop({ required: true, enum: ROLES })
  role!: Role;

  @Prop({ required: true, select: false, unique: true })
  tokenHash!: string;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop()
  acceptedAt?: Date;

  @Prop()
  revokedAt?: Date;

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, ref: "User" })
  invitedBy!: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export type InvitationDocument = Invitation & Document;
export const InvitationSchema = SchemaFactory.createForClass(Invitation);
InvitationSchema.index({ tenantId: 1, email: 1 });
InvitationSchema.plugin(tenantScopePlugin);
