import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Membership, MembershipSchema } from "./schemas/membership.schema";
import { MembershipsService } from "./memberships.service";

@Module({
  imports: [MongooseModule.forFeature([{ name: Membership.name, schema: MembershipSchema }])],
  providers: [MembershipsService],
  exports: [MembershipsService],
})
export class MembershipsModule {}
