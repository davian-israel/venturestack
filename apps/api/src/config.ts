import { z } from 'zod';

/**
 * All configuration comes from environment variables (Railway service variables).
 * Integrations whose keys are missing are reported as disabled rather than crashing,
 * so the platform can boot before every account is connected.
 */
const bool = (d: boolean) => z.preprocess((v) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase())), z.boolean());

const schema = z.object({
  NODE_ENV: z.string().default('production'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().default('postgres://postgres:postgres@localhost:5432/venturestack'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  PUBLIC_WEB_URL: z.string().default('http://localhost:3000'),
  PUBLIC_API_URL: z.string().default('http://localhost:3001'),
  JWT_SECRET: z.string().default('dev-only-change-me'),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  PAST_DUE_GRACE_DAYS: z.coerce.number().default(7),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-5-5'),

  RAILWAY_API_TOKEN: z.string().optional(),
  RAILWAY_PROJECT_ID: z.string().optional(),
  RAILWAY_ENVIRONMENT_ID: z.string().optional(),

  // Transactional email to clients (magic links, digests, reports)
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default('Venturestack <hello@example.com>'),
  OWNER_EMAIL: z.string().default('davianr@gmail.com'),

  // Marketing
  MARKETING_ENABLED: bool(false),
  MARKETING_TZ: z.string().default('Europe/London'),
  MARKETING_START_HOUR: z.coerce.number().default(3),
  MARKETING_BUDGET_MINUTES: z.coerce.number().default(60),
  MARKETING_DAILY_SEND_CAP: z.coerce.number().default(60),
  MARKETING_CLIENT_CLAIMS: bool(false),
  MARKETING_POSTAL_ADDRESS: z.string().optional(),
  MARKETING_BOOKING_URL: z.string().optional(),
  MARKETING_SENDER_NAME: z.string().default('Davian'),
  MARKETING_SENDER_TITLE: z.string().default('Founder'),
  INSTANTLY_API_KEY: z.string().optional(),
  INSTANTLY_CAMPAIGN_ID: z.string().optional(),
  /** JSON map product_slug -> Instantly campaign id; falls back to INSTANTLY_CAMPAIGN_ID. */
  INSTANTLY_CAMPAIGNS: z.string().default('{}'),
  TREG_PEOPLE_CALL: z.string().optional(),
  TREG_API_KEY: z.string().optional(),
  APOLLO_API_KEY: z.string().optional(),
  X_BEARER_TOKEN: z.string().optional(),
  LINKEDIN_ACCESS_TOKEN: z.string().optional(),
  LINKEDIN_ORG_URN: z.string().optional(),

  // Agent Reach sources
  REDDIT_CLIENT_ID: z.string().optional(),
  REDDIT_CLIENT_SECRET: z.string().optional(),
  REDDIT_USER_AGENT: z.string().default('venturestack-agent-reach/1.0'),
  YOUTUBE_API_KEY: z.string().optional(),

  // Fulfilment integrations
  GPU_DUB_ENDPOINT: z.string().optional(),
  GPU_DUB_TOKEN: z.string().optional(),
  DUB_API_KEY: z.string().optional(),
  DUB_API_URL: z.string().default('https://api.dub.co'),
});

export type Config = z.infer<typeof schema>;
export const config: Config = schema.parse(process.env);

export const integrations = () => ({
  stripe: !!config.STRIPE_SECRET_KEY,
  anthropic: !!config.ANTHROPIC_API_KEY,
  railway: !!(config.RAILWAY_API_TOKEN && config.RAILWAY_PROJECT_ID && config.RAILWAY_ENVIRONMENT_ID),
  email: !!config.RESEND_API_KEY,
  instantly: !!(config.INSTANTLY_API_KEY && (config.INSTANTLY_CAMPAIGN_ID || config.INSTANTLY_CAMPAIGNS !== '{}')),
  prospecting: !!((config.TREG_API_KEY && config.TREG_PEOPLE_CALL) || config.APOLLO_API_KEY),
  x: !!config.X_BEARER_TOKEN,
  linkedin: !!(config.LINKEDIN_ACCESS_TOKEN && config.LINKEDIN_ORG_URN),
  reddit: !!(config.REDDIT_CLIENT_ID && config.REDDIT_CLIENT_SECRET),
  youtube: !!config.YOUTUBE_API_KEY,
  gpuDub: !!config.GPU_DUB_ENDPOINT,
  dub: !!config.DUB_API_KEY,
});
