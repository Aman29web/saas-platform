import { z } from "zod";

export const changeRoleSchema = z.object({
  role: z.enum(["admin", "member"]),
});
export type ChangeRoleDto = z.infer<typeof changeRoleSchema>;
