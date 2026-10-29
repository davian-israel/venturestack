import type { ProductSlug } from '@vs/catalog';

export interface ProductContext {
  tenantId: string;
  email: string;
  company: string | null;
  config: Record<string, any>;
  serviceUrl?: string | null;
}

export interface DeliveryResult {
  title: string;
  body: Record<string, unknown>;
  /** Email to send the client (HTML). Omit to deliver to the portal only. */
  emailHtml?: string;
}

export interface ProductHandler {
  slug: ProductSlug;
  /** Cron pattern (in Europe/London) for recurring fulfilment, or null for on-demand only. */
  schedule: string | null;
  /** Onboarding fields the portal asks for before the first run. */
  onboardingFields: { key: string; label: string; type: 'text' | 'textarea' | 'url' | 'list' | 'secret'; required?: boolean }[];
  /** Produces one deliverable. Throwing marks the job failed and it is retried. */
  run(ctx: ProductContext): Promise<DeliveryResult | null>;
}
