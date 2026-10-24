import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Schema as MongooseSchema, Types } from "mongoose";
import { tenantScopePlugin } from "../../tenancy/tenant-scope.plugin";

@Schema({ timestamps: true, collection: "projects" })
export class Project {
  _id!: Types.ObjectId;

  // Stamped automatically by tenantScopePlugin — never set this by hand.
  @Prop({ required: true, index: true })
  tenantId!: string;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, ref: "User" })
  createdBy!: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export type ProjectDocument = Project & Document;
export const ProjectSchema = SchemaFactory.createForClass(Project);
ProjectSchema.index({ tenantId: 1, createdAt: -1 });
ProjectSchema.plugin(tenantScopePlugin);
