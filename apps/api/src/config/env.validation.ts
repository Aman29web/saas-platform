import { apiEnvSchema, type ApiEnv } from "@saas/shared";

export function validateEnv(config: Record<string, unknown>): ApiEnv {
  const result = apiEnvSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
