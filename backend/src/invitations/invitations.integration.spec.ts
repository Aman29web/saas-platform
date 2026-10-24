import { Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ConfigModule } from "@nestjs/config";
import cookieParser from "cookie-parser";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { getModelToken } from "@nestjs/mongoose";
import { Types } from "mongoose";
import { InvitationsModule } from "./invitations.module";
import { ProjectsModule } from "../projects/projects.module";
import { InvitationsService } from "./invitations.service";
import { Invitation } from "./schemas/invitation.schema";
import { NotificationsModule } from "../notifications/notifications.module";
import { EmailQueueService, type InviteEmailPayload } from "../notifications/email-queue.service";
import { MembershipsService } from "../memberships/memberships.service";
import { validateEnv } from "../config/env.validation";

const sentEmails: InviteEmailPayload[] = [];

class FakeEmailQueueService extends EmailQueueService {
  async enqueueInviteEmail(payload: InviteEmailPayload): Promise<void> {
    sentEmails.push(payload);
  }
}

// Replaces the real NotificationsModule (which needs a live Redis
// connection for BullMQ) so this suite never touches Redis.
@Module({
  providers: [{ provide: EmailQueueService, useClass: FakeEmailQueueService }],
  exports: [EmailQueueService],
})
class FakeNotificationsModule {}

describe("Invitations (proof)", () => {
  let replSet: MongoMemoryReplSet;
  let app: INestApplication;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = "a".repeat(32);
    process.env.JWT_REFRESH_SECRET = "b".repeat(32);
    process.env.JWT_ACCESS_TTL = "15m";
    process.env.JWT_REFRESH_TTL = "30d";
    process.env.MONGO_URI = "mongodb://placeholder/placeholder";
    process.env.REDIS_URL = "redis://placeholder:6379";
    process.env.WEB_APP_URL = "http://localhost:5173";

    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
        MongooseModule.forRoot(replSet.getUri()),
        InvitationsModule,
        ProjectsModule,
      ],
    })
      .overrideModule(NotificationsModule)
      .useModule(FakeNotificationsModule)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix("api");
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await replSet.stop();
  });

  async function signupAndLogin(email: string, orgName: string) {
    const signup = await request(app.getHttpServer()).post("/api/auth/signup").send({
      name: "User",
      email,
      password: "correct-horse-battery",
      orgName,
    });
    const cookies = (signup.headers["set-cookie"] as unknown as string[])
      .map((c) => c.split(";")[0])
      .join("; ");
    return { cookies, orgId: signup.body.organization.id as string, email };
  }

  function extractToken(acceptUrl: string): string {
    return new URL(acceptUrl).searchParams.get("token")!;
  }

  it("inviting a member enqueues an email with a working accept link", async () => {
    const owner = await signupAndLogin("invite-owner@example.com", "Invite Org");
    sentEmails.length = 0;

    const invite = await request(app.getHttpServer())
      .post("/api/invitations")
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId)
      .send({ email: "invitee@example.com", role: "member" });

    expect(invite.status).toBe(201);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe("invitee@example.com");
    expect(sentEmails[0].orgName).toBe("Invite Org");

    const token = extractToken(sentEmails[0].acceptUrl);
    const preview = await request(app.getHttpServer()).get(`/api/invitations/public/${token}`);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      email: "invitee@example.com",
      role: "member",
      orgName: "Invite Org",
      expired: false,
      revoked: false,
      accepted: false,
    });
  });

  it("a member role cannot send invitations", async () => {
    const owner = await signupAndLogin("invite-owner-2@example.com", "Invite Org 2");
    const other = await signupAndLogin("invite-other-2@example.com", "Other Org 2");

    // Add `other` as a plain member of owner's org (Module E has no self-serve
    // path for this yet besides accepting an invite, so this uses the same
    // direct-membership shortcut the RBAC tests use).
    const otherLogin = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: other.email, password: "correct-horse-battery" });
    const membershipsService = app.get(MembershipsService);
    await membershipsService.create({
      userId: new Types.ObjectId(otherLogin.body.user.id),
      orgId: new Types.ObjectId(owner.orgId),
      role: "member",
    });

    const res = await request(app.getHttpServer())
      .post("/api/invitations")
      .set("Cookie", other.cookies)
      .set("X-Org-Id", owner.orgId)
      .send({ email: "someone@example.com", role: "member" });

    expect(res.status).toBe(403);
  });

  it("an existing user can accept an invitation and gains membership in the inviting org", async () => {
    const owner = await signupAndLogin("invite-owner-3@example.com", "Invite Org 3");
    const invitee = await signupAndLogin("invitee-3@example.com", "Invitee's Own Org 3");
    sentEmails.length = 0;

    await request(app.getHttpServer())
      .post("/api/invitations")
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId)
      .send({ email: "invitee-3@example.com", role: "admin" });

    const token = extractToken(sentEmails[0].acceptUrl);

    const accept = await request(app.getHttpServer())
      .post("/api/invitations/public/accept")
      .set("Cookie", invitee.cookies)
      .send({ token });

    expect(accept.status).toBe(201);
    expect(accept.body.orgId).toBe(owner.orgId);
    expect(accept.body.role).toBe("admin");

    // Invitee can now act with admin permissions in the owner's org.
    const createProject = await request(app.getHttpServer())
      .post("/api/projects")
      .set("Cookie", invitee.cookies)
      .set("X-Org-Id", owner.orgId)
      .send({ name: "created by accepted invitee" });
    expect(createProject.status).toBe(201);
  });

  it("a token is single-use: accepting twice fails the second time", async () => {
    const owner = await signupAndLogin("invite-owner-4@example.com", "Invite Org 4");
    const invitee = await signupAndLogin("invitee-4@example.com", "Invitee's Own Org 4");
    sentEmails.length = 0;

    await request(app.getHttpServer())
      .post("/api/invitations")
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId)
      .send({ email: "invitee-4@example.com", role: "member" });

    const token = extractToken(sentEmails[0].acceptUrl);

    const first = await request(app.getHttpServer())
      .post("/api/invitations/public/accept")
      .set("Cookie", invitee.cookies)
      .send({ token });
    expect(first.status).toBe(201);

    const second = await request(app.getHttpServer())
      .post("/api/invitations/public/accept")
      .set("Cookie", invitee.cookies)
      .send({ token });
    expect(second.status).toBe(409);
  });

  it("an expired invitation cannot be accepted", async () => {
    const owner = await signupAndLogin("invite-owner-5@example.com", "Invite Org 5");
    const invitee = await signupAndLogin("invitee-5@example.com", "Invitee's Own Org 5");
    sentEmails.length = 0;

    await request(app.getHttpServer())
      .post("/api/invitations")
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId)
      .send({ email: "invitee-5@example.com", role: "member" });

    const token = extractToken(sentEmails[0].acceptUrl);

    const invitationsService = app.get(InvitationsService);
    const invitation = await invitationsService.findByRawToken(token);
    if (!invitation) throw new Error("invitation should exist for this test");
    const invitationModel = app.get(getModelToken(Invitation.name));
    await invitationModel.collection.updateOne(
      { _id: invitation._id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );

    const accept = await request(app.getHttpServer())
      .post("/api/invitations/public/accept")
      .set("Cookie", invitee.cookies)
      .send({ token });
    expect(accept.status).toBe(409);
  });

  it("accepting with a different account than the invited email is rejected", async () => {
    const owner = await signupAndLogin("invite-owner-6@example.com", "Invite Org 6");
    const wrongAccount = await signupAndLogin("wrong-account-6@example.com", "Wrong Account Org 6");
    sentEmails.length = 0;

    await request(app.getHttpServer())
      .post("/api/invitations")
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId)
      .send({ email: "intended-recipient-6@example.com", role: "member" });

    const token = extractToken(sentEmails[0].acceptUrl);

    const accept = await request(app.getHttpServer())
      .post("/api/invitations/public/accept")
      .set("Cookie", wrongAccount.cookies)
      .send({ token });
    expect(accept.status).toBe(403);
  });

  it("revoking a pending invitation prevents it from being accepted", async () => {
    const owner = await signupAndLogin("invite-owner-7@example.com", "Invite Org 7");
    const invitee = await signupAndLogin("invitee-7@example.com", "Invitee's Own Org 7");
    sentEmails.length = 0;

    const invite = await request(app.getHttpServer())
      .post("/api/invitations")
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId)
      .send({ email: "invitee-7@example.com", role: "member" });
    const invitationId = invite.body._id;

    const revoke = await request(app.getHttpServer())
      .delete(`/api/invitations/${invitationId}`)
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId);
    expect(revoke.status).toBe(204);

    const token = extractToken(sentEmails[0].acceptUrl);
    const accept = await request(app.getHttpServer())
      .post("/api/invitations/public/accept")
      .set("Cookie", invitee.cookies)
      .send({ token });
    expect(accept.status).toBe(409);
  });

  it("resending an invitation issues a new token and invalidates the old one", async () => {
    const owner = await signupAndLogin("invite-owner-8@example.com", "Invite Org 8");
    const invitee = await signupAndLogin("invitee-8@example.com", "Invitee's Own Org 8");
    sentEmails.length = 0;

    const invite = await request(app.getHttpServer())
      .post("/api/invitations")
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId)
      .send({ email: "invitee-8@example.com", role: "member" });
    const invitationId = invite.body._id;
    const oldToken = extractToken(sentEmails[0].acceptUrl);

    const resend = await request(app.getHttpServer())
      .post(`/api/invitations/${invitationId}/resend`)
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId);
    expect(resend.status).toBe(201);
    expect(sentEmails).toHaveLength(2);
    const newToken = extractToken(sentEmails[1].acceptUrl);
    expect(newToken).not.toBe(oldToken);

    const acceptOld = await request(app.getHttpServer())
      .post("/api/invitations/public/accept")
      .set("Cookie", invitee.cookies)
      .send({ token: oldToken });
    expect(acceptOld.status).toBe(404);

    const acceptNew = await request(app.getHttpServer())
      .post("/api/invitations/public/accept")
      .set("Cookie", invitee.cookies)
      .send({ token: newToken });
    expect(acceptNew.status).toBe(201);
  });

  it("the pending-invites list only shows unaccepted, unrevoked invitations for the active org", async () => {
    const owner = await signupAndLogin("invite-owner-9@example.com", "Invite Org 9");

    await request(app.getHttpServer())
      .post("/api/invitations")
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId)
      .send({ email: "pending-a-9@example.com", role: "member" });
    const toRevoke = await request(app.getHttpServer())
      .post("/api/invitations")
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId)
      .send({ email: "pending-b-9@example.com", role: "member" });

    await request(app.getHttpServer())
      .delete(`/api/invitations/${toRevoke.body._id}`)
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId);

    const list = await request(app.getHttpServer())
      .get("/api/invitations")
      .set("Cookie", owner.cookies)
      .set("X-Org-Id", owner.orgId);

    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].email).toBe("pending-a-9@example.com");
  });
});
