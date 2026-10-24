import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, ClientSession, Types } from "mongoose";
import { Organization, OrganizationDocument } from "./schemas/organization.schema";
import { slugify, randomSlugSuffix } from "./utils/slugify";

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectModel(Organization.name)
    private readonly orgModel: Model<OrganizationDocument>,
  ) {}

  async findById(id: string | Types.ObjectId) {
    return this.orgModel.findById(id).exec();
  }

  async findBySlug(slug: string) {
    return this.orgModel.findOne({ slug }).exec();
  }

  private async generateUniqueSlug(name: string, session?: ClientSession): Promise<string> {
    const base = slugify(name) || "org";
    let candidate = base;
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await this.orgModel.findOne({ slug: candidate }, null, { session }).exec();
      if (!existing) return candidate;
      candidate = `${base}-${randomSlugSuffix()}`;
    }
    return `${base}-${randomSlugSuffix()}-${Date.now()}`;
  }

  async create(data: { name: string; ownerId: Types.ObjectId }, session?: ClientSession) {
    const slug = await this.generateUniqueSlug(data.name, session);
    const [org] = await this.orgModel.create(
      [{ name: data.name, slug, ownerId: data.ownerId }],
      { session },
    );
    return org;
  }
}
