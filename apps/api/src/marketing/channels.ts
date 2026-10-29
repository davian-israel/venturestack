import { config } from '../config';

/** Owned-channel publishing via official APIs only. */

export async function postToX(text: string): Promise<string | undefined> {
  if (!config.X_BEARER_TOKEN) return undefined;
  const res = await fetch('https://api.x.com/2/tweets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.X_BEARER_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text.slice(0, 280) }),
  });
  if (!res.ok) throw new Error(`X ${res.status}: ${await res.text()}`);
  return ((await res.json()) as any).data?.id;
}

export async function postToLinkedIn(text: string): Promise<string | undefined> {
  if (!config.LINKEDIN_ACCESS_TOKEN || !config.LINKEDIN_ORG_URN) return undefined;
  const res = await fetch('https://api.linkedin.com/rest/posts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.LINKEDIN_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'LinkedIn-Version': '202510',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify({
      author: config.LINKEDIN_ORG_URN,
      commentary: text.slice(0, 2900),
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    }),
  });
  if (!res.ok) throw new Error(`LinkedIn ${res.status}: ${await res.text()}`);
  return res.headers.get('x-restli-id') ?? undefined;
}

/** Pushes a lead with fully-rendered steps into an Instantly campaign whose template is {{step1_subject}} / {{step1_body}} ... */
export async function pushToInstantly(campaignId: string, lead: { email: string; firstName?: string; company?: string; steps: { subject: string; body: string }[] }) {
  const custom: Record<string, string> = {};
  lead.steps.forEach((s, i) => {
    custom[`step${i + 1}_subject`] = s.subject;
    custom[`step${i + 1}_body`] = s.body;
  });
  const res = await fetch('https://api.instantly.ai/api/v2/leads', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.INSTANTLY_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      campaign: campaignId,
      email: lead.email,
      first_name: lead.firstName,
      company_name: lead.company,
      skip_if_in_workspace: true,
      skip_if_in_campaign: true,
      custom_variables: custom,
    }),
  });
  if (!res.ok) throw new Error(`Instantly ${res.status}: ${await res.text()}`);
}

export function campaignFor(slug: string): string | undefined {
  try {
    const map = JSON.parse(config.INSTANTLY_CAMPAIGNS) as Record<string, string>;
    return map[slug] ?? config.INSTANTLY_CAMPAIGN_ID;
  } catch {
    return config.INSTANTLY_CAMPAIGN_ID;
  }
}
