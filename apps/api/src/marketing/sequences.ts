import { bySlug, ProductSlug, usd } from '@vs/catalog';

/**
 * 4-step cold sequences (Day 1, 4, 8, 13). Agent Reach uses Davian's sequence verbatim in structure;
 * the other 7 follow the same shape using each product's hook from the video.
 *
 * Slots ({{...}}) are filled from the prospect row and the proof gathered that morning. A step with
 * any unfilled slot is never sent (see guardrails.assertFilled).
 * Sentences that claim existing clients are wrapped in [[clients]]...[[/clients]] and are removed
 * unless MARKETING_CLIENT_CLAIMS=true (switch on after the first paying client).
 */
export interface Step {
  day: number;
  subject: string;
  body: string;
}

export const STEP_DAYS = [1, 4, 8, 13];

const SIGN = `{{senderName}}\n{{senderTitle}}`;

const AGENT_REACH: Step[] = [
  {
    day: 1,
    subject: '{{threadCount}} people looking for {{company}} this week',
    body: `Hi {{firstName}},

Saw you're leading growth at {{company}}.

Over the last 7 days I spotted a few public threads where people were asking for exactly what {{company}} does.

I pulled the highest-intent ones and drafted quick, non-salesy replies in your tone so your team can jump in:

{{threadBlock}}

I run an automated monitor that flags 5 of these buying-intent conversations every morning with replies pre-drafted.

Would it be helpful if I kept sending these over each morning?

Best,
${SIGN}`,
  },
  {
    day: 4,
    subject: 'Re: {{threadCount}} people looking for {{company}} this week',
    body: `Hi {{firstName}},

Following up — another thread popped up this week: "{{freshThreadTitle}}" ({{freshThreadUrl}}).

[[clients]]Most SaaS teams we work with miss these conversations because social listening tools either cost thousands in API fees or flood them with noise.[[/clients]]

It's a flat {{monthly}}/month to get the top 5 high-intent conversations in your inbox or Slack every morning, with draft replies ready to post.

Mind if I send a 2-minute video showing how it filters for intent?

Best,
{{senderName}}`,
  },
  {
    day: 8,
    subject: 'Where your competitors are losing deals',
    body: `Hi {{firstName}},

A side-effect of the monitor is competitor intelligence: every week it catches what people complain about with {{competitor}} — pricing changes, broken integrations, slow support.

That gives your team real-time angles to position {{company}} as the obvious alternative.

Open to a 10-minute look at the live feed for {{company}}? Pick any time here: {{bookingUrl}}

Best,
{{senderName}}`,
  },
  {
    day: 13,
    subject: 'Permission to close your file?',
    body: `Hi {{firstName}},

I'll assume tracking live buying intent isn't a priority right now, so I won't crowd your inbox.

If you ever want a daily feed of people raising their hands for {{company}}'s category, just reply.

Here's the thread page from earlier in case your team still wants those drafts: {{proofUrl}}

Best of luck with growth this quarter!

{{senderName}}`,
  },
];

function genericSequence(slug: ProductSlug): Step[] {
  const p = bySlug(slug)!;
  return [
    {
      day: 1,
      subject: p.hook.length <= 70 ? p.hook : `${p.name} for {{company}}`,
      body: `Hi {{firstName}},

Quick one for {{company}}: ${p.hook}

${p.tagline}

I put together something specific for {{company}} so you can judge it on substance: {{proofUrl}}

Worth a look?

Best,
${SIGN}`,
    },
    {
      day: 4,
      subject: 'Re: {{company}}',
      body: `Hi {{firstName}},

Following up on the note above. What you'd get:
${p.deliverables.map((d) => `- ${d}`).join('\n')}

It's ${usd(p.setupFeeCents)} to set up and ${usd(p.monthlyCents)}/month after that, all run for you.

[[clients]]Teams like yours usually see it pay for itself in the first month.[[/clients]]

Should I send a 2-minute walkthrough?

{{senderName}}`,
    },
    {
      day: 8,
      subject: `${p.name} for {{company}}`,
      body: `Hi {{firstName}},

If now's a fit, here's my calendar for a 10-minute look: {{bookingUrl}}

Or start directly: {{checkoutUrl}}

{{senderName}}`,
    },
    {
      day: 13,
      subject: 'Permission to close your file?',
      body: `Hi {{firstName}},

I'll stop here so I don't crowd your inbox. If ${p.name.toLowerCase()} becomes a priority, just reply.

The page I made for {{company}} stays up: {{proofUrl}}

{{senderName}}`,
    },
  ];
}

export function sequenceFor(slug: ProductSlug): Step[] {
  return slug === 'agent-reach' ? AGENT_REACH : genericSequence(slug);
}

export function applyClaimsToggle(text: string, allowClaims: boolean): string {
  return allowClaims
    ? text.replace(/\[\[\/?clients\]\]/g, '')
    : text.replace(/\[\[clients\]\][\s\S]*?\[\[\/clients\]\]\n?\n?/g, '');
}

export function footer(postalAddress: string, unsubscribeUrl: string): string {
  return `\n\n—\n${postalAddress}\nNot relevant? Unsubscribe in one click: ${unsubscribeUrl}`;
}
