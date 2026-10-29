import { ProductSlug } from '@vs/catalog';
import { config } from '../config';

/**
 * Prospect sources. Apollo is the concrete default; Treg is supported through its single /call/
 * gateway — set TREG_PEOPLE_CALL to the people-search endpoint path you picked in Treg's catalog
 * (e.g. "/call/<provider>/<endpoint>") and the request body below is forwarded as-is.
 */
export interface Prospect {
  email: string;
  firstName?: string;
  company?: string;
  domain?: string;
  niche?: string;
  title?: string;
  source: string;
}

/** Audience filters per product, taken from the video. */
export const AUDIENCE: Record<ProductSlug, { titles: string[]; employees: string[]; keywords: string[] }> = {
  'agent-reach': { titles: ['founder', 'head of growth', 'vp marketing', 'marketing lead'], employees: ['5,50'], keywords: ['b2b saas', 'marketing agency'] },
  'security-audit': { titles: ['founder', 'ceo', 'co-founder'], employees: ['1,10'], keywords: ['saas', 'ai app', 'lovable', 'bolt', 'replit'] },
  'voice-studio': { titles: ['founder', 'creator', 'coach'], employees: ['1,10'], keywords: ['online course', 'coaching', 'youtube', 'personal finance', 'fitness'] },
  'sales-dept': { titles: ['vp sales', 'head of sales', 'sales director'], employees: ['20,200'], keywords: ['saas', 'msp', 'logistics', 'staffing'] },
  'kpi-dashboards': { titles: ['owner', 'controller', 'cfo', 'president'], employees: ['20,100'], keywords: ['contractor', 'clinic', 'distributor', 'manufacturing'] },
  'digital-archive': { titles: ['managing partner', 'owner', 'office manager'], employees: ['5,50'], keywords: ['cpa', 'accounting', 'law firm', 'property management', 'title company'] },
  'ar-recovery': { titles: ['owner', 'controller', 'cfo'], employees: ['10,200'], keywords: ['commercial contractor', 'distributor', 'manufacturing', 'b2b services'] },
  'offline-attribution': { titles: ['owner', 'marketing manager', 'general manager'], employees: ['5,100'], keywords: ['hvac', 'roofing', 'plumbing', 'real estate team', 'print shop'] },
};

async function apolloSearch(slug: ProductSlug, limit: number): Promise<Prospect[]> {
  const a = AUDIENCE[slug];
  const res = await fetch('https://api.apollo.io/api/v1/mixed_people/search', {
    method: 'POST',
    headers: { 'X-Api-Key': config.APOLLO_API_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      person_titles: a.titles,
      organization_num_employees_ranges: a.employees,
      q_organization_keyword_tags: a.keywords,
      contact_email_status: ['verified'],
      page: 1 + Math.floor(Math.random() * 20),
      per_page: Math.min(limit, 25),
    }),
  });
  if (!res.ok) throw new Error(`Apollo search ${res.status}`);
  const people = ((await res.json()) as any).people ?? [];
  const out: Prospect[] = [];
  for (const p of people.slice(0, limit)) {
    // Search results omit emails; reveal the work email via people/match (credit-metered).
    const m = await fetch('https://api.apollo.io/api/v1/people/match', {
      method: 'POST',
      headers: { 'X-Api-Key': config.APOLLO_API_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.id, reveal_personal_emails: false }),
    });
    if (!m.ok) continue;
    const person = ((await m.json()) as any).person;
    if (!person?.email || person.email_status !== 'verified') continue;
    out.push({
      email: person.email.toLowerCase(),
      firstName: person.first_name,
      company: person.organization?.name,
      domain: person.organization?.primary_domain,
      niche: (person.organization?.keywords ?? []).slice(0, 5).join(', ') || person.organization?.industry,
      title: person.title,
      source: 'apollo',
    });
  }
  return out;
}

async function tregSearch(slug: ProductSlug, limit: number): Promise<Prospect[]> {
  const a = AUDIENCE[slug];
  const res = await fetch(`https://treg.to${config.TREG_PEOPLE_CALL}`, {
    method: 'POST',
    headers: { 'X-Treg-Token': config.TREG_API_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ titles: a.titles, employee_ranges: a.employees, keywords: a.keywords, limit }),
  });
  if (!res.ok) throw new Error(`Treg ${res.status}`);
  const j = (await res.json()) as any;
  const rows: any[] = j.people ?? j.results ?? j.data ?? [];
  return rows
    .filter((r) => r.email)
    .map((r) => ({
      email: String(r.email).toLowerCase(),
      firstName: r.first_name ?? r.firstName,
      company: r.company ?? r.organization?.name,
      domain: r.domain ?? r.organization?.domain,
      niche: r.industry,
      title: r.title,
      source: 'treg',
    }));
}

export async function findProspects(slug: ProductSlug, limit: number): Promise<Prospect[]> {
  if (config.TREG_API_KEY && config.TREG_PEOPLE_CALL) return tregSearch(slug, limit);
  if (config.APOLLO_API_KEY) return apolloSearch(slug, limit);
  return [];
}
