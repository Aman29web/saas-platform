import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, ClientSession, Types } from "mongoose";
import { Membership, MembershipDocument } from "./schemas/membership.schema";
import type { Role } from "../common/enums";

@Injectable()
export class MembershipsService {
  constructor(
    @InjectModel(Membership.name)
    private readonly membershipModel: Model<MembershipDocument>,
  ) {}

  async create(
    data: { userId: Types.ObjectId; orgId: Types.ObjectId; role: Role; invitedBy?: Types.ObjectId },
    session?: ClientSession,
  ) {
    const [membership] = await this.membershipModel.create([data], { session });
    return membership;
  }

  async listByUser(userId: string | Types.ObjectId) {
    return this.membershipModel
      .find({ userId, status: "active" })
      .populate("orgId")
      .exec();
  }

  async findOne(userId: string | Types.ObjectId, orgId: string | Types.ObjectId) {
    return this.membershipModel.findOne({ userId, orgId, status: "active" }).exec();
  }

  async listForOrg(orgId: string | Types.ObjectId) {
    return this.membershipModel
      .find({ orgId, status: "active" })
      .populate("userId", "name email")
      .sort({ createdAt: 1 })
      .exec();
  }

  async updateRole(orgId: string | Types.ObjectId, targetUserId: string | Types.ObjectId, newRole: Role) {
    const membership = await this.membershipModel.findOne({ orgId, userId: targetUserId, status: "active" }).exec();
    if (!membership) return null;
    if (membership.role === "owner") return "cannot_change_owner" as const;

    membership.role = newRole;
    await membership.save();
    return membership;
  }

  async remove(orgId: string | Types.ObjectId, targetUserId: string | Types.ObjectId) {
    const membership = await this.membershipModel.findOne({ orgId, userId: targetUserId, status: "active" }).exec();
    if (!membership) return null;
    if (membership.role === "owner") return "cannot_remove_owner" as const;

    membership.status = "removed";
    await membership.save();
    return membership;
  }
}
