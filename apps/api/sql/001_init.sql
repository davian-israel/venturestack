-- Core schema for the 8-system platform. Idempotent: safe to run on every boot.

CREATE TABLE IF NOT EXISTS tenants (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email              TEXT NOT NULL UNIQUE,
  company            TEXT,
  stripe_customer_id TEXT UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per (tenant, product). The paywall reads only this table.
CREATE TABLE IF NOT EXISTS entitlements (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_slug           TEXT NOT NULL,
  status                 TEXT NOT NULL,          -- active | trialing | past_due | canceled | one_off
  stripe_subscription_id TEXT UNIQUE,
  current_period_end     TIMESTAMPTZ,
  grace_until            TIMESTAMPTZ,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, product_slug)
);

-- Stripe event ids we have processed (webhook idempotency).
CREATE TABLE IF NOT EXISTS stripe_events (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Client onboarding answers + legal consents per product.
CREATE TABLE IF NOT EXISTS onboarding (
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_slug TEXT NOT NULL,
  config       JSONB NOT NULL DEFAULT '{}'::jsonb,
  consent_type TEXT,
  consent_name TEXT,
  consent_at   TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, product_slug)
);

-- Per-client OSS services provisioned on Railway.
CREATE TABLE IF NOT EXISTS provisioned_services (
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_slug       TEXT NOT NULL,
  railway_service_id TEXT,
  url                TEXT,
  state              TEXT NOT NULL DEFAULT 'pending', -- pending | live | suspended | deleted
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, product_slug)
);

-- Deliverables shown in the client portal (digests, reports, QR packs...).
CREATE TABLE IF NOT EXISTS deliveries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_slug TEXT NOT NULL,
  title        TEXT NOT NULL,
  body         JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deliveries_tenant_idx ON deliveries (tenant_id, created_at DESC);

-- ---------- Marketing ----------
CREATE TABLE IF NOT EXISTS prospects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_slug  TEXT NOT NULL,
  email         TEXT NOT NULL,
  first_name    TEXT,
  company       TEXT,
  domain        TEXT,
  niche         TEXT,
  competitor    TEXT,
  source        TEXT NOT NULL,
  lawful_basis  TEXT NOT NULL DEFAULT 'legitimate_interest_b2b',
  proof_slug    TEXT UNIQUE,
  proof         JSONB,
  step          INT NOT NULL DEFAULT 0,       -- last sequence step sent (0 = none)
  next_send_at  TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'new',  -- new | proofed | sequencing | replied | unsubscribed | skipped | done
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_slug, email)
);

-- Global do-not-contact list. Checked before every send, across all products.
CREATE TABLE IF NOT EXISTS suppression (
  email      TEXT PRIMARY KEY,
  reason     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marketing_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  stats       JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS content_posts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_slug TEXT NOT NULL,
  channel      TEXT NOT NULL,   -- blog | x | linkedin
  slug         TEXT,
  title        TEXT,
  body         TEXT NOT NULL,
  external_id  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
