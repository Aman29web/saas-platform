import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { MongooseModule } from "@nestjs/mongoose";
import { BullModule } from "@nestjs/bullmq";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { APP_GUARD, APP_FILTER } from "@nestjs/core";
import Redis from "ioredis";
import { LoggerModule } from "nestjs-pino";
import { validateEnv } from "./config/env.validation";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { ProjectsModule } from "./projects/projects.module";
import { AdminModule } from "./admin/admin.module";
import { InvitationsModule } from "./invitations/invitations.module";
import { BillingModule } from "./billing/billing.module";
import { UsageModule } from "./usage/usage.module";
import { UsageRollupModule } from "./usage/usage-rollup.module";
import { AuditLogModule } from "./audit-log/audit-log.module";
import { OrgMembersModule } from "./memberships/org-members.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import type { ApiEnv } from "./config/env.schema";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === "production" ? "info" : "debug",
        transport:
          process.env.NODE_ENV === "production"
            ? undefined
            : { target: "pino-pretty", options: { colorize: true, singleLine: true } },
        redact: ["req.headers.authorization", "req.headers.cookie"],
      },
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<ApiEnv, true>) => ({
        uri: config.get("MONGO_URI", { infer: true }),
      }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<ApiEnv, true>) => ({
        connection: new Redis(config.get("REDIS_URL", { infer: true }), { maxRetriesPerRequest: null }),
      }),
    }),
    // Default: 100 requests/minute per IP. Auth, invite, and billing
    // endpoints override this with a stricter limit via @Throttle().
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 100 }],
    }),
    HealthModule,
    AuthModule,
    ProjectsModule,
    AdminModule,
    InvitationsModule,
    BillingModule,
    UsageModule,
    UsageRollupModule,
    AuditLogModule,
    OrgMembersModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
