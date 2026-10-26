import { Global, Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { AuditLog, AuditLogSchema } from "./schemas/audit-log.schema";
import { AuditLogService } from "./audit-log.service";
import { AuditLogController } from "./audit-log.controller";
import { AuthModule } from "../auth/auth.module";
import { TenancyModule } from "../tenancy/tenancy.module";
import { UsersModule } from "../users/users.module";
import { MembershipsModule } from "../memberships/memberships.module";

// Global so AuditLogService can be injected from any feature module (the
// whole point is that sensitive actions across the codebase can log to it)
// without each one needing to re-declare the Mongoose feature binding.
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([{ name: AuditLog.name, schema: AuditLogSchema }]),
    AuthModule,
    TenancyModule,
    UsersModule,
    MembershipsModule,
  ],
  providers: [AuditLogService],
  controllers: [AuditLogController],
  exports: [AuditLogService],
})
export class AuditLogModule {}
