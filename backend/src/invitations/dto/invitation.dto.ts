import { z } from "zod";
import { ROLES } from "../../common/enums";

export const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(ROLES).refine((role) => role !== "owner", {
    message: "Cannot invite someone directly as owner",
  }),
});
export type InviteMemberDto = z.infer<typeof inviteMemberSchema>;

export const acceptInviteSchema = z.object({
  token: z.string().min(1),
});
export type AcceptInviteDto = z.infer<typeof acceptInviteSchema>;
