import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Project, ProjectSchema } from "../projects/schemas/project.schema";
import { AdminController } from "./admin.controller";
import { ImpersonationExitController } from "./impersonation-exit.controller";
import { ProjectsAdminService } from "./projects-admin.service";
import { ImpersonationService } from "./impersonation.service";
import { AuthModule } from "../auth/auth.module";
import { UsersModule } from "../users/users.module";
import { MembershipsModule } from "../memberships/memberships.module";
import { AuditLogModule } from "../audit-log/audit-log.module";

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Project.name, schema: ProjectSchema }]),
    AuthModule,
    // AuthGuard is applied via @UseGuards() below; see the comment in
    // ProjectsModule for why UsersModule must be imported here too.
    UsersModule,
    MembershipsModule,
    AuditLogModule,
  ],
  controllers: [AdminController, ImpersonationExitController],
  providers: [ProjectsAdminService, ImpersonationService],
})
export class AdminModule {}
