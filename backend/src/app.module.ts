import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { MongooseModule } from "@nestjs/mongoose";
import { BullModule } from "@nestjs/bullmq";
import Redis from "ioredis";
import { LoggerModule } from "nestjs-pino";
import { validateEnv } from "./config/env.validation";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { ProjectsModule } from "./projects/projects.module";
import { AdminModule } from "./admin/admin.module";
import { InvitationsModule } from "./invitations/invitations.module";
import { BillingModule } from "./billing/billing.module";
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
    HealthModule,
    AuthModule,
    ProjectsModule,
    AdminModule,
    InvitationsModule,
    BillingModule,
  ],
})
export class AppModule {}
