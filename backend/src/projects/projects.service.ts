import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { Project, ProjectDocument } from "./schemas/project.schema";
import { TenantContext } from "../tenancy/tenant-context";
import type { CreateProjectDto, UpdateProjectDto } from "./dto/project.dto";

@Injectable()
export class ProjectsService {
  constructor(@InjectModel(Project.name) private readonly projectModel: Model<ProjectDocument>) {}

  async create(dto: CreateProjectDto) {
    const ctx = TenantContext.get();
    if (!ctx) throw new Error("ProjectsService.create called with no tenant context");

    // tenantId is stamped automatically by tenantScopePlugin's pre('save') hook.
    return this.projectModel.create({ name: dto.name, createdBy: ctx.userId });
  }

  async findAll() {
    return this.projectModel.find().sort({ createdAt: -1 }).exec();
  }

  async findOneOrThrow(id: string) {
    const project = await this.projectModel.findById(id).exec();
    if (!project) throw new NotFoundException("Project not found");
    return project;
  }

  async update(id: string, dto: UpdateProjectDto) {
    const project = await this.findOneOrThrow(id);
    project.name = dto.name;
    await project.save();
    return project;
  }

  async remove(id: string) {
    await this.findOneOrThrow(id);
    await this.projectModel.deleteOne({ _id: id }).exec();
  }
}
