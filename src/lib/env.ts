import { z } from "zod";

const blankToUndefined = (value: unknown): unknown => {
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }

  return value;
};

const optionalEnv = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(blankToUndefined, schema.optional());
const defaultedEnv = <T extends z.ZodTypeAny>(schema: T, defaultValue: z.infer<T>) =>
  z.preprocess(blankToUndefined, schema.default(defaultValue));

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  OPENAI_API_KEY: optionalEnv(z.string().min(20)),
  OPENAI_MODEL: defaultedEnv(z.string(), "gpt-5.5"),
  OPENAI_COST_INPUT_CENTS_PER_1K: defaultedEnv(z.coerce.number().nonnegative(), 1),
  OPENAI_COST_OUTPUT_CENTS_PER_1K: defaultedEnv(z.coerce.number().nonnegative(), 4),

  CRON_SECRET: z.string().min(16),
  DASHBOARD_API_TOKEN: z.string().min(32),
  APPROVAL_SECRET: z.string().min(32),
  PUBLIC_BASE_URL: z.string().url(),

  OWNER_PHONE: z.string().regex(/^\+\d{8,15}$/),
  OWNER_EMAIL: optionalEnv(z.string().email()),

  TWILIO_ACCOUNT_SID: optionalEnv(z.string()),
  TWILIO_AUTH_TOKEN: optionalEnv(z.string()),
  TWILIO_PHONE_NUMBER: optionalEnv(z.string().regex(/^\+\d{8,15}$/)),

  RETELL_API_KEY: optionalEnv(z.string()),
  RETELL_AGENT_ID: optionalEnv(z.string()),
  RETELL_EXECUTIVE_ASSISTANT_AGENT_ID: optionalEnv(z.string()),
  RETELL_FROM_NUMBER: optionalEnv(z.string().regex(/^\+\d{8,15}$/)),

  MAKE_EMAIL_WEBHOOK_URL: optionalEnv(z.string().url()),
  MAKE_WEBHOOK_SECRET: optionalEnv(z.string().min(16)),
  FROM_EMAIL: optionalEnv(z.string().email()),
  REPLY_TO_EMAIL: optionalEnv(z.string().email())
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
