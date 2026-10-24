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
}
