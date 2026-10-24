import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { Project, ProjectDocument } from "../projects/schemas/project.schema";

@Injectable()
export class ProjectsAdminService {
  constructor(@InjectModel(Project.name) private readonly projectModel: Model<ProjectDocument>) {}

  // Only ever call this from inside runAsTenantBypass — the plugin will
  // throw if neither a tenant context nor a bypass is active.
  async findAllAcrossTenants() {
    return this.projectModel.find().sort({ tenantId: 1, createdAt: -1 }).exec();
  }
}
