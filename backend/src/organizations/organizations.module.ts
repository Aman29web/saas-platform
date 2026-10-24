import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Organization, OrganizationSchema } from "./schemas/organization.schema";
import { OrganizationsService } from "./organizations.service";

@Module({
  imports: [MongooseModule.forFeature([{ name: Organization.name, schema: OrganizationSchema }])],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
