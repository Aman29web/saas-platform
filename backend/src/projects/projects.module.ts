import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Project, ProjectSchema } from "./schemas/project.schema";
import { ProjectsService } from "./projects.service";
import { ProjectsController } from "./projects.controller";
import { AuthModule } from "../auth/auth.module";
import { TenancyModule } from "../tenancy/tenancy.module";
import { UsersModule } from "../users/users.module";
import { MembershipsModule } from "../memberships/memberships.module";

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Project.name, schema: ProjectSchema }]),
    AuthModule,
    TenancyModule,
    // AuthGuard and TenantContextGuard are applied via @UseGuards() below;
    // Nest resolves a guard's own constructor deps using the CONSUMING
    // module's injector too, so UsersService/MembershipsService must be
    // reachable here, not just inside AuthModule/TenancyModule.
    UsersModule,
    MembershipsModule,
  ],
  providers: [ProjectsService],
  controllers: [ProjectsController],
  exports: [ProjectsService],
})
export class ProjectsModule {}
