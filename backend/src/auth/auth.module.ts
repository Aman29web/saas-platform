import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { MongooseModule } from "@nestjs/mongoose";
import { RefreshToken, RefreshTokenSchema } from "./schemas/refresh-token.schema";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AuthGuard } from "./auth.guard";
import { TokensService } from "./tokens.service";
import { RefreshTokensService } from "./refresh-tokens.service";
import { UsersModule } from "../users/users.module";
import { OrganizationsModule } from "../organizations/organizations.module";
import { MembershipsModule } from "../memberships/memberships.module";

@Module({
  imports: [
    JwtModule.register({}),
    MongooseModule.forFeature([{ name: RefreshToken.name, schema: RefreshTokenSchema }]),
    UsersModule,
    OrganizationsModule,
    MembershipsModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, TokensService, RefreshTokensService],
  exports: [AuthGuard, TokensService],
})
export class AuthModule {}
