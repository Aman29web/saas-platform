import { z } from "zod";

export const createProjectSchema = z.object({
  name: z.string().min(1).max(160),
});
export type CreateProjectDto = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(160),
});
export type UpdateProjectDto = z.infer<typeof updateProjectSchema>;
