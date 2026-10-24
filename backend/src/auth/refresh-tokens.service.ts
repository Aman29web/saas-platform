import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import * as argon2 from "argon2";
import { RefreshToken, RefreshTokenDocument } from "./schemas/refresh-token.schema";

@Injectable()
export class RefreshTokensService {
  constructor(
    @InjectModel(RefreshToken.name)
    private readonly refreshTokenModel: Model<RefreshTokenDocument>,
  ) {}

  async createPlaceholder(userId: Types.ObjectId, expiresAt: Date) {
    return this.refreshTokenModel.create({ userId, tokenHash: "", expiresAt });
  }

  async setTokenHash(id: Types.ObjectId, rawToken: string) {
    const tokenHash = await argon2.hash(rawToken);
    await this.refreshTokenModel.updateOne({ _id: id }, { tokenHash }).exec();
  }

  async findById(id: string) {
    return this.refreshTokenModel.findById(id).select("+tokenHash").exec();
  }

  async revoke(id: Types.ObjectId, replacedByTokenHash?: string) {
    await this.refreshTokenModel
      .updateOne({ _id: id }, { revokedAt: new Date(), replacedByTokenHash })
      .exec();
  }

  async revokeAllForUser(userId: string | Types.ObjectId) {
    await this.refreshTokenModel
      .updateMany({ userId, revokedAt: { $exists: false } }, { revokedAt: new Date() })
      .exec();
  }

  async verifyMatches(doc: RefreshTokenDocument, rawToken: string): Promise<boolean> {
    if (!doc.tokenHash) return false;
    return argon2.verify(doc.tokenHash, rawToken);
  }
}
