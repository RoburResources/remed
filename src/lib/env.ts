import { z } from "zod";

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  OPENAI_API_KEY: z.string().min(20).optional(),
  OPENAI_MODEL: z.string().default("gpt-5.5"),
  OPENAI_COST_INPUT_CENTS_PER_1K: z.coerce.number().nonnegative().default(1),
  OPENAI_COST_OUTPUT_CENTS_PER_1K: z.coerce.number().nonnegative().default(4),

  CRON_SECRET: z.string().min(16),
  DASHBOARD_API_TOKEN: z.string().min(32),
  APPROVAL_SECRET: z.string().min(32),
  PUBLIC_BASE_URL: z.string().url(),

  OWNER_PHONE: z.string().regex(/^\+\d{8,15}$/),

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().regex(/^\+\d{8,15}$/).optional(),

  RETELL_API_KEY: z.string().optional(),
  RETELL_AGENT_ID: z.string().optional(),
  RETELL_EXECUTIVE_ASSISTANT_AGENT_ID: z.string().optional(),
  RETELL_FROM_NUMBER: z.string().regex(/^\+\d{8,15}$/).optional(),

  MAKE_EMAIL_WEBHOOK_URL: z.string().url().optional(),
  MAKE_WEBHOOK_SECRET: z.string().min(16).optional(),
  FROM_EMAIL: z.string().email().optional(),
  REPLY_TO_EMAIL: z.string().email().optional()
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (cachedEnv) return cachedEnv;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${message}`);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}

export function resetEnvCacheForTests(): void {
  cachedEnv = null;
}

export function hasTwilioCredentials(env = getEnv()): boolean {
  return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_PHONE_NUMBER);
}

export function hasRetellCredentials(env = getEnv()): boolean {
  return Boolean(
    env.RETELL_API_KEY &&
      (env.RETELL_AGENT_ID || env.RETELL_EXECUTIVE_ASSISTANT_AGENT_ID) &&
      (env.RETELL_FROM_NUMBER || env.TWILIO_PHONE_NUMBER)
  );
}

export function getExecutiveAssistantAgentId(env = getEnv()): string | undefined {
  return env.RETELL_EXECUTIVE_ASSISTANT_AGENT_ID ?? env.RETELL_AGENT_ID;
}
