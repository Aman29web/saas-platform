import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UseGuards, UseInterceptors } from "@nestjs/common";
import { TenantContextGuard } from "../tenancy/tenant-context.guard";
import { TenantContextInterceptor } from "../tenancy/tenant-context.interceptor";
import { RequirePermission } from "../rbac/require-permission.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { createProjectSchema, updateProjectSchema, type CreateProjectDto, type UpdateProjectDto } from "./dto/project.dto";
import { ProjectsService } from "./projects.service";

// TenantContextGuard validates and resolves the tenant; TenantContextInterceptor
// (which MUST come after the guard in the request pipeline — guards run
// before interceptors regardless of decorator order) scopes it with
// AsyncLocalStorage for the handler's execution. See both files for why
// this is split across a guard and an interceptor instead of one guard.
@Controller("projects")
@UseGuards(TenantContextGuard)
@UseInterceptors(TenantContextInterceptor)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @RequirePermission("projects:create")
  create(@Body(new ZodValidationPipe(createProjectSchema)) dto: CreateProjectDto) {
    return this.projectsService.create(dto);
  }

  @Get()
  findAll() {
    return this.projectsService.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.projectsService.findOneOrThrow(id);
  }

  @Put(":id")
  @RequirePermission("projects:update")
  update(@Param("id") id: string, @Body(new ZodValidationPipe(updateProjectSchema)) dto: UpdateProjectDto) {
    return this.projectsService.update(id, dto);
  }

  @Delete(":id")
  @RequirePermission("projects:delete")
  @HttpCode(204)
  async remove(@Param("id") id: string) {
    await this.projectsService.remove(id);
  }
}
