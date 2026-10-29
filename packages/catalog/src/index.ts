/**
 * Single source of truth for the 8 productized systems.
 * Prices are in USD cents. Both the API (Stripe bootstrap, entitlements,
 * fulfilment) and the storefront (landing pages) read from here.
 */

export type ProductSlug =
  | 'agent-reach'
  | 'security-audit'
  | 'voice-studio'
  | 'sales-dept'
  | 'kpi-dashboards'
  | 'digital-archive'
  | 'ar-recovery'
  | 'offline-attribution';

export interface Product {
  slug: ProductSlug;
  name: string;
  tagline: string;
  ossBase: string;
  ossRepo: string;
  setupFeeCents: number;
  monthlyCents: number;
  /** Optional one-off price (e.g. a single audit without retainer). */
  oneOffCents?: number;
  audience: string;
  signal: string;
  hook: string;
  deliverables: string[];
  /** Does this product need a dedicated per-client Railway service? */
  perClientService?: { template: string; image: string; port: number };
  /** Legal gate the client must accept during onboarding. */
  consentGate?: 'voice-consent' | 'audit-authorization' | 'data-processing';
  /** Launch order; lower ships first. */
  wave: number;
  /** The job a buyer hires it for — groups the storefront index. */
  job: 'find-buyers' | 'protect-prove' | 'back-office';
  /** When results arrive, in plain words. */
  cadence: string;
  /** Example of what lands in the client's inbox (illustrative, labelled as an example on the site). */
  sample: { time: string; line: string }[];
  /** Paying clients targeted (from the video's scale plan). */
  targetClients: number;
  /** One-off sales per month targeted (Security Audit only). */
  targetOneOffPerMonth?: number;
  /** Estimated variable delivery cost per client per month, in cents, excluding AI tokens (measured separately): hosting, GPU, SaaS seats. */
  estCostPerClientCents: number;
}

export const PRODUCTS: Product[] = [
  {
    slug: 'agent-reach',
    name: 'Agent Reach',
    tagline: 'Five warm buyers asking for you, in your inbox every morning.',
    ossBase: 'Agent Reach',
    ossRepo: 'https://github.com/search?q=agent-reach',
    setupFeeCents: 50_000,
    monthlyCents: 40_000,
    audience: 'Founders, heads of growth and marketing leads at B2B SaaS companies and agencies (5–50 staff)',
    signal: 'Recent funding or hiring for growth roles',
    hook: '3 people were looking for {{company}} this week',
    deliverables: [
      'Daily digest of the top 5 public threads where people ask for what you sell',
      'A reply drafted in your brand voice for every thread',
      'Weekly competitor-complaint roundup',
    ],
    consentGate: 'data-processing',
    wave: 1,
    job: 'find-buyers',
    cadence: "Every morning by 7:00",
    sample: [
      { time: "03:04", line: "Searched Reddit, Hacker News and YouTube for people asking for tools like yours" },
      { time: "03:21", line: "Scored 61 threads for buying intent and kept the top 5" },
      { time: "03:40", line: "Drafted a reply for each, in your voice" },
      { time: "07:00", line: "Digest sent to your inbox and Slack" },
    ],
    targetClients: 10,
    estCostPerClientCents: 1000,
  },
  {
    slug: 'security-audit',
    name: 'AI App Security Audit',
    tagline: 'Find the exposed keys and open databases in your AI-built app before someone else does.',
    ossBase: 'Cloudflare security audit skill',
    ossRepo: 'https://github.com/cloudflare',
    setupFeeCents: 150_000,
    monthlyCents: 30_000,
    oneOffCents: 150_000,
    audience: 'Non-technical founders with paying users on apps built with Lovable, Bolt, Cursor or Replit (1–10 staff)',
    signal: 'Launched on an AI builder in the last 12 months',
    hook: '7 holes we find in almost every AI-built app',
    deliverables: [
      '6-phase structured audit of your codebase',
      'Plain-English remediation report, ranked by severity',
      'Re-audit on every new release (retainer)',
    ],
    consentGate: 'audit-authorization',
    wave: 2,
    job: 'protect-prove',
    cadence: "Report within 48 hours, then on every new release",
    sample: [
      { time: "03:02", line: "Read the code you gave us access to" },
      { time: "03:18", line: "Checked for exposed keys and open database tables" },
      { time: "03:35", line: "Tested sign-up and payment logic for bypasses" },
      { time: "07:00", line: "Plain-English report, worst issues first" },
    ],
    targetClients: 5,
    estCostPerClientCents: 500,
    targetOneOffPerMonth: 4,
  },
  {
    slug: 'voice-studio',
    name: 'Spanish Channel in a Box',
    tagline: 'Your best videos, in Spanish, in your own voice — uploaded for you.',
    ossBase: 'Voice Studio',
    ossRepo: 'https://github.com/search?q=voice-studio',
    setupFeeCents: 100_000,
    monthlyCents: 75_000,
    audience: 'Coaches, course creators and YouTubers with 10k–250k subscribers in finance, business or fitness',
    signal: 'No Spanish-language channel',
    hook: 'Here is your top video in Spanish, in your voice (60-second sample)',
    deliverables: ['Up to 8 dubbed videos per month', 'Spanish subtitles', 'Upload and scheduling to your Spanish channel'],
    consentGate: 'voice-consent',
    wave: 3,
    job: 'find-buyers',
    cadence: "Two videos a week, up to eight a month",
    sample: [
      { time: "03:05", line: "Picked your next best-performing video" },
      { time: "03:30", line: "Translated and voiced it in Spanish, in your voice" },
      { time: "04:10", line: "Added Spanish subtitles" },
      { time: "07:00", line: "Scheduled on your Spanish channel" },
    ],
    targetClients: 6,
    estCostPerClientCents: 3000,
  },
  {
    slug: 'sales-dept',
    name: 'AI Sales Department',
    tagline: '2-minute call prep, follow-up drafts and a Monday pipeline brief — inside your CRM.',
    ossBase: 'Anthropic skills / plugins',
    ossRepo: 'https://github.com/anthropics/skills',
    setupFeeCents: 250_000,
    monthlyCents: 50_000,
    audience: 'VPs of Sales at B2B companies (20–200 staff, 3–15 reps) on HubSpot or Close',
    signal: 'Hiring SDRs or AEs',
    hook: 'Here is a call-prep brief we wrote for one of your own deals',
    deliverables: ['Custom Claude skills pack for your playbook', 'Call-prep briefs before every meeting', 'Monday pipeline summary'],
    consentGate: 'data-processing',
    wave: 2,
    job: 'find-buyers',
    cadence: "Before every call, plus a Monday pipeline brief",
    sample: [
      { time: "03:03", line: "Pulled today's meetings from your CRM" },
      { time: "03:20", line: "Wrote a two-minute brief for each call" },
      { time: "03:45", line: "Flagged deals with slipping close dates" },
      { time: "07:00", line: "Briefs waiting before your first call" },
    ],
    targetClients: 4,
    estCostPerClientCents: 500,
  },
  {
    slug: 'kpi-dashboards',
    name: 'Executive KPI Dashboard',
    tagline: 'Your 5–10 numbers that matter, in one place, with a Monday morning briefing.',
    ossBase: 'Metabase',
    ossRepo: 'https://github.com/metabase/metabase',
    setupFeeCents: 250_000,
    monthlyCents: 40_000,
    audience: 'Owners and controllers at contractors, clinics, distributors and manufacturers ($2M–$20M revenue)',
    signal: 'Hiring a reporting analyst',
    hook: 'What are the 5 numbers you check every Monday?',
    deliverables: ['Unified dashboard across QuickBooks, CRM and ads', 'Monday briefing email', 'New KPIs on request'],
    perClientService: { template: 'metabase', image: 'metabase/metabase:latest', port: 3000 },
    consentGate: 'data-processing',
    wave: 3,
    job: 'back-office',
    cadence: "Live dashboard, plus a briefing every Monday",
    sample: [
      { time: "03:00", line: "Refreshed numbers from your accounts, CRM and ads" },
      { time: "03:15", line: "Updated your 5–10 key numbers" },
      { time: "03:30", line: "Wrote what changed since last week" },
      { time: "07:00", line: "Monday briefing in your inbox" },
    ],
    targetClients: 5,
    estCostPerClientCents: 2000,
  },
  {
    slug: 'digital-archive',
    name: 'Digital Archive & Search',
    tagline: 'Find any file from 2021 in seconds — just ask.',
    ossBase: 'Paperless-ngx',
    ossRepo: 'https://github.com/paperless-ngx/paperless-ngx',
    setupFeeCents: 200_000,
    monthlyCents: 20_000,
    audience: 'CPA firms, law offices, property managers and title companies (5–50 staff)',
    signal: 'Hiring a file clerk',
    hook: 'How long does it take you to find a file from 2021?',
    deliverables: ['OCR and auto-tagging of every document', 'Ask-your-files AI search', 'Auto-filing of new documents'],
    perClientService: { template: 'paperless-ngx', image: 'ghcr.io/paperless-ngx/paperless-ngx:latest', port: 8000 },
    consentGate: 'data-processing',
    wave: 3,
    job: 'back-office',
    cadence: "Searchable within 30 days; new files filed as they arrive",
    sample: [
      { time: "03:01", line: "Read and filed 140 new scanned documents" },
      { time: "03:25", line: "Tagged them by client, year and type" },
      { time: "03:40", line: "Indexed them for plain-English questions" },
      { time: "07:00", line: "Ask it: what was the lease term for 14 High St?" },
    ],
    targetClients: 6,
    estCostPerClientCents: 1500,
  },
  {
    slug: 'ar-recovery',
    name: 'AR Recovery Autopilot',
    tagline: 'Get paid on overdue invoices without chasing anyone.',
    ossBase: 'Invoice Ninja',
    ossRepo: 'https://github.com/invoiceninja/invoiceninja',
    setupFeeCents: 100_000,
    monthlyCents: 30_000,
    audience: 'Owners and controllers at B2B service firms, contractors and distributors with $50k+ overdue',
    signal: 'Hiring a billing coordinator',
    hook: 'What is your receivables balance over 60 days right now?',
    deliverables: ['Payment links on every invoice', 'Reminders at 3, 7, 14 and 30 days', 'AI-drafted escalations', 'Weekly aging report'],
    perClientService: { template: 'invoiceninja', image: 'invoiceninja/invoiceninja:5', port: 80 },
    consentGate: 'data-processing',
    wave: 2,
    job: 'back-office',
    cadence: "Reminders every weekday, aging report on Mondays",
    sample: [
      { time: "03:02", line: "Checked every open invoice" },
      { time: "03:10", line: "Sent pay-now reminders at 3, 7 and 14 days overdue" },
      { time: "03:30", line: "Drafted firm notices for invoices 30+ days late" },
      { time: "07:00", line: "Aging report in your inbox on Mondays" },
    ],
    targetClients: 8,
    estCostPerClientCents: 1000,
  },
  {
    slug: 'offline-attribution',
    name: 'Offline Ad Attribution',
    tagline: 'Know which mailer, yard sign and van wrap actually made money.',
    ossBase: 'Dub',
    ossRepo: 'https://github.com/dubinc/dub',
    setupFeeCents: 50_000,
    monthlyCents: 25_000,
    audience: 'HVAC, roofing and plumbing companies spending $3k+/month on print; real-estate teams; print shops',
    signal: 'Active direct-mail or print advertising',
    hook: 'Which of your last three mailers actually made money?',
    deliverables: ['Unique QR codes and short links per placement', 'Monthly ROI report by channel'],
    consentGate: 'data-processing',
    wave: 2,
    job: 'protect-prove',
    cadence: "QR codes on day one, ROI report on the 1st",
    sample: [
      { time: "03:00", line: "Made a tracked QR code for each mailer, sign and van" },
      { time: "03:12", line: "Counted scans by placement" },
      { time: "03:20", line: "Matched scans against what each placement cost" },
      { time: "07:00", line: "Monthly report: what paid, and what didn't" },
    ],
    targetClients: 10,
    estCostPerClientCents: 500,
  },
];

export const bySlug = (slug: string): Product | undefined => PRODUCTS.find((p) => p.slug === slug);

export const usd = (cents: number): string =>
  `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

/** Monthly revenue target: recurring at target clients + targeted one-off sales. $26,100 at the video's scale plan. */
export const targetMonthlyRevenueCents = (products: Product[] = PRODUCTS): number =>
  products.reduce((sum, p) => sum + p.targetClients * p.monthlyCents + (p.targetOneOffPerMonth ?? 0) * (p.oneOffCents ?? 0), 0);

export const JOBS: { id: Product['job']; title: string; blurb: string }[] = [
  { id: 'find-buyers', title: 'Find buyers', blurb: 'Put you in front of people who are already looking.' },
  { id: 'protect-prove', title: 'Protect and prove', blurb: 'Close the holes and show what your spend returns.' },
  { id: 'back-office', title: 'Run the back office', blurb: 'Numbers, files and unpaid invoices, handled.' },
];
