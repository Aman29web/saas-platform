import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, ClientSession, Types } from "mongoose";
import { User, UserDocument } from "./schemas/user.schema";

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

  async findByEmail(email: string, opts?: { withPasswordHash?: boolean }) {
    const query = this.userModel.findOne({ email: email.toLowerCase().trim() });
    if (opts?.withPasswordHash) query.select("+passwordHash");
    return query.exec();
  }

  async findById(id: string | Types.ObjectId) {
    return this.userModel.findById(id).exec();
  }

  async create(
    data: { email: string; name: string; passwordHash: string },
    session?: ClientSession,
  ) {
    const [user] = await this.userModel.create([data], { session });
    return user;
  }
}
