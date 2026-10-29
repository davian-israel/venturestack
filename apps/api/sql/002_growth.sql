-- Growth tracking: revenue, costs, funnel, campaigns, optimiser. Idempotent.

ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ;
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS source_ref  TEXT;
ALTER TABLE prospects    ADD COLUMN IF NOT EXISTS variant_id  UUID;
ALTER TABLE prospects    ADD COLUMN IF NOT EXISTS enrolled_at TIMESTAMPTZ;
ALTER TABLE prospects    ADD COLUMN IF NOT EXISTS won_at      TIMESTAMPTZ;

-- Cash actually collected (from Stripe invoices / one-off checkouts).
CREATE TABLE IF NOT EXISTS payments (
  id             TEXT PRIMARY KEY,               -- Stripe invoice or checkout session id
  tenant_id      UUID REFERENCES tenants(id) ON DELETE SET NULL,
  product_slug   TEXT,
  amount_cents   INT NOT NULL,
  fee_cents_est  INT NOT NULL DEFAULT 0,
  kind           TEXT NOT NULL,                  -- first | recurring | one_off
  paid_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_paid_idx ON payments (paid_at);

-- Website funnel: page views, proof-page views, checkout starts and completions.
CREATE TABLE IF NOT EXISTS funnel_events (
  id           BIGSERIAL PRIMARY KEY,
  type         TEXT NOT NULL,                    -- page_view | proof_view | checkout_started | checkout_completed
  product_slug TEXT,
  ref          TEXT,                             -- proof slug of the prospect, when attributed
  source       TEXT,                             -- utm_source / channel
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS funnel_events_idx ON funnel_events (created_at, type);

-- Email campaign events from Instantly webhooks.
CREATE TABLE IF NOT EXISTS campaign_events (
  id           BIGSERIAL PRIMARY KEY,
  email        TEXT NOT NULL,
  product_slug TEXT,
  event        TEXT NOT NULL,                    -- sent | opened | clicked | replied | bounced | unsubscribed
  step         INT,
  variant_id   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaign_events_idx ON campaign_events (created_at, product_slug, event);

-- Costs: AI tokens (measured), prospecting, payment fees (est.), fixed monthly tools.
CREATE TABLE IF NOT EXISTS cost_events (
  id           BIGSERIAL PRIMARY KEY,
  day          DATE NOT NULL DEFAULT CURRENT_DATE,
  product_slug TEXT,
  kind         TEXT NOT NULL,                    -- ai | prospecting | stripe_fees | delivery
  amount_cents NUMERIC(12,4) NOT NULL,
  meta         JSONB
);
CREATE INDEX IF NOT EXISTS cost_events_idx ON cost_events (day, kind);

-- Daily snapshot for trend charts.
CREATE TABLE IF NOT EXISTS mrr_snapshots (
  day          DATE NOT NULL,
  product_slug TEXT NOT NULL,
  clients      INT NOT NULL,
  mrr_cents    INT NOT NULL,
  PRIMARY KEY (day, product_slug)
);

-- Settings the weekly optimiser is allowed to change (bounded; see optimiser.ts).
CREATE TABLE IF NOT EXISTS growth_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Subject-line A/B variants for step 1 of each sequence.
CREATE TABLE IF NOT EXISTS sequence_variants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_slug TEXT NOT NULL,
  step         INT NOT NULL DEFAULT 1,
  subject      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',   -- active | retired
  source       TEXT NOT NULL DEFAULT 'default',  -- default | optimiser
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at   TIMESTAMPTZ
);

-- Every weekly review, automatic change and recommendation, with its reason.
CREATE TABLE IF NOT EXISTS optimiser_log (
  id           BIGSERIAL PRIMARY KEY,
  week         DATE NOT NULL,
  kind         TEXT NOT NULL,                    -- review | change | recommendation
  product_slug TEXT,
  summary      TEXT NOT NULL,
  detail       JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Server-generated secrets (JWT signing, field encryption) so they never need to be typed or shared.
CREATE TABLE IF NOT EXISTS app_secrets (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
