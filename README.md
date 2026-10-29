# Venturestack — 8 productized systems on one platform

The 8 systems from Corey Ganim's "8 free GitHub repos" video, built as paywalled SaaS products. They share one NestJS API, one Next.js storefront, one Stripe paywall and one 03:00 marketing autopilot.

| Product | Open-source base | Setup | Monthly | Fulfilment |
| --- | --- | --- | --- | --- |
| Agent Reach | Agent Reach | $500 | $400 | Daily top-5 buying-intent threads + drafted replies |
| AI App Security Audit | Cloudflare audit skill | $1,500 | $300 | 6-phase code audit, re-audit on each release |
| Spanish Channel in a Box | Voice Studio | $1,000 | $750 | 8 dubbed videos/month via GPU worker |
| AI Sales Department | Anthropic skills | $2,500 | $500 | Skills pack, daily call prep, Monday pipeline |
| Executive KPI Dashboard | Metabase (per client) | $2,500 | $400 | Monday KPI briefing |
| Digital Archive & Search | Paperless-ngx (per client) | $2,000 | $200 | OCR archive + "ask your files" |
| AR Recovery Autopilot | Invoice Ninja (per client) | $1,000 | $300 | 3/7/14/30-day reminders, escalations, aging |
| Offline Ad Attribution | Dub | $500 | $250 | QR/short link per placement, monthly ROI |

## Layout

```
packages/catalog   product catalog (prices, audiences, hooks) shared by api + web
apps/api           NestJS API  ─ src/main.ts       HTTP: checkout, webhook, portal, proof pages, blog
                               ─ src/worker.ts     BullMQ: provisioning, fulfilment schedules
                               ─ src/marketer.ts   Railway cron: daily 03:00 London marketing run
                               ─ src/products/*    one module per system (DDD bounded contexts)
apps/web           Next.js storefront: 8 landing pages, checkout, client portal, /for/<proof>, /blog
railway/*.json     config-as-code for the 4 Railway services
```

## The paywall

- Every product is sold through Stripe Checkout: the setup fee and the monthly subscription are taken in one payment.
- The Stripe webhook (signature-verified, idempotent, retry-safe) writes the `entitlements` table.
- `EntitlementGuard` blocks every portal route unless the entitlement is `active`, `trialing`, `one_off`, or `past_due` within the 7-day grace period.
- The worker checks the same rule before any fulfilment run.
- When a subscription is cancelled, the client's dedicated Railway service is scaled to zero. When they pay again, it comes back.

## Deploy to Railway

1. Push this repo to GitHub.
2. In Railway, create a project with **Postgres** and **Redis**.
3. Add 4 services from the repo. Set each service's *Config file path*:
   - `api`: `railway/api.json`; generate a public domain.
   - `worker`: `railway/worker.json`.
   - `marketer`: `railway/marketer.json` (cron `0 2,3 * * *` UTC; the code only runs at 03:xx London).
   - `web`: `railway/web.json`; generate a public domain.
4. Set the variables from `.env.example` on api, worker and marketer (use shared variables). Set `NEXT_PUBLIC_API_URL` and `API_INTERNAL_URL` on web.
5. Run once: `railway run -s api npm run stripe:bootstrap`. This creates the 8 products and their prices plus the webhook, and prints `STRIPE_WEBHOOK_SECRET`. Set that secret on the api service.
6. Run a test purchase with card `4242 4242 4242 4242`.

## Marketing autopilot (03:00–04:00 Europe/London, unattended)

| Minutes | Step |
| --- | --- |
| 0–15 | Pull prospects per product audience (Apollo, or Treg via `TREG_PEOPLE_CALL`) |
| 15–30 | Proof: real intent threads (Agent Reach), or a labelled tailored sample, hosted at `/for/<id>` |
| 30–45 | Render the 4-step sequence (Day 1/4/8/13) and push to the product's Instantly campaign |
| 45–55 | One post per product to your own X and LinkedIn pages; one SEO article per product per week |
| 55–60 | Report emailed to `OWNER_EMAIL` |

**Instantly campaign setup.** Create one campaign per product with 4 steps and delays of 0/3/4/5 days (Day 1/4/8/13). Each step's subject is `{{step1_subject}}`…`{{step4_subject}}` and its body is `{{step1_body}}`…`{{step4_body}}`. Turn on stop-on-reply. Point the campaign webhook at `/webhooks/instantly?key=<unsubSig("instantly-webhook")>`.

The marketer enrols leads during the 03:00 hour. Instantly sends during the campaign's own schedule, so set that to the recipients' business hours.

### Guardrails enforced in code (tested)

- Only business addresses: free-mail and role inboxes are dropped.
- A global suppression list, a signed one-click unsubscribe link and your postal address go on every email. Nothing sends until `MARKETING_POSTAL_ADDRESS` is set.
- Agent Reach emails only go out when at least 2 real threads were found that morning. A template slot that isn't filled blocks the send.
- Claims about "clients we work with" are stripped until `MARKETING_CLIENT_CLAIMS=true`.
- Agent Reach uses official APIs only (Reddit, YouTube Data, HN). It never scrapes LinkedIn or X.
- Voice cloning requires signed consent. Security audits read code only, from a token the client grants.

## Tests

```
npm test                    # unit tests: paywall rules, consent gates, send guardrails, 03:00 window, AR aging
```
