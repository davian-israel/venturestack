import { config } from '../config';
import { one, q } from '../db/db';

/**
 * Growth settings: the levers the weekly optimiser may move. Each has hard bounds so an
 * automated change can never push the business outside what Davian configured.
 */
export interface GrowthSettings {
  dailySendCap: number;          // new prospects enrolled per day across all products
  maxWave: number;               // 1 = Agent Reach only … 3 = all 8
  weights: Record<string, number>; // share of the send cap per product (sums to 1 over active products)
  paused: string[];              // products whose outreach is paused (deliverability)
  targetDate: string;            // YYYY-MM-DD for hitting the monthly revenue target
  fixedMonthlyCostCents: number; // tools + infra (Railway, Instantly, Apollo, domains…)
}

export const BOUNDS = {
  dailySendCapMin: 10,
  dailySendCapCeiling: Number(process.env.MARKETING_SEND_CAP_CEILING ?? 150),
  weeklyCapStep: 10,
  minWeight: 0.1,
};

export function defaults(): GrowthSettings {
  return {
    dailySendCap: config.MARKETING_DAILY_SEND_CAP,
    maxWave: Number(process.env.MARKETING_MAX_WAVE ?? 1),
    weights: {},
    paused: [],
    targetDate: process.env.TARGET_DATE ?? '2027-04-30',
    fixedMonthlyCostCents: Math.round(Number(process.env.MONTHLY_FIXED_COST_USD ?? 0) * 100),
  };
}

export async function getSettings(): Promise<GrowthSettings> {
  const row = await one<{ value: Partial<GrowthSettings> }>(`SELECT value FROM growth_settings WHERE key='growth'`);
  return { ...defaults(), ...(row?.value ?? {}) };
}

export async function saveSettings(s: GrowthSettings): Promise<void> {
  await q(
    `INSERT INTO growth_settings (key, value) VALUES ('growth',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
    [s],
  );
}
