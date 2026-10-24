import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Schema as MongooseSchema, Types } from "mongoose";

@Schema({ timestamps: true, collection: "refresh_tokens" })
export class RefreshToken {
  _id!: Types.ObjectId;

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, ref: "User", index: true })
  userId!: Types.ObjectId;

  @Prop({ select: false, default: "" })
  tokenHash!: string;

  @Prop({ required: true, index: true })
  expiresAt!: Date;

  @Prop()
  revokedAt?: Date;

  @Prop()
  replacedByTokenHash?: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export type RefreshTokenDocument = RefreshToken & Document;
export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshToken);
