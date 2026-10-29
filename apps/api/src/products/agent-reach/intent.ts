import { askJson } from '../../ai/claude';
import { searchAll, Thread } from './sources';

export interface IntentBrief {
  company: string;
  whatTheySell: string;
  keywords: string[];
  competitors?: string[];
  voice?: string; // a few sentences describing brand tone
}

export interface ScoredThread extends Thread {
  intent: number; // 0-100
  why: string;
  reply: string;
}

/** Builds search queries from a brief: buying-intent phrasings × keywords and competitor alternatives. */
export function buildQueries(b: IntentBrief): string[] {
  const qs = new Set<string>();
  for (const k of b.keywords.slice(0, 5)) {
    qs.add(`"${k}" recommendation`);
    qs.add(`looking for ${k}`);
    qs.add(`best ${k} tool`);
  }
  for (const c of (b.competitors ?? []).slice(0, 3)) {
    qs.add(`${c} alternative`);
    qs.add(`switching from ${c}`);
  }
  return [...qs].slice(0, 12);
}

/**
 * Finds the top-N buying-intent threads from the last `days` days and drafts a reply for each.
 * Every returned thread is real (came from a source API) — nothing is invented.
 */
export async function findIntent(brief: IntentBrief, opts: { top?: number; days?: number } = {}): Promise<ScoredThread[]> {
  const top = opts.top ?? 5;
  const threads = await searchAll(buildQueries(brief), opts.days ?? 7);
  if (threads.length === 0) return [];

  const candidates = threads.slice(0, 60);
  const scored = await askJson<{ id: string; intent: number; why: string; reply: string }[]>(
    `You score public social threads for buying intent for a specific company and draft replies.
Score 0-100: 80+ = the author is explicitly asking for a recommendation or alternative that ${brief.company} fits; under 40 = not a buyer.
Replies: 2 sentences, genuinely helpful first, mention ${brief.company} once and naturally, no links, no hype, disclose affiliation ("I work on ${brief.company}").
Brand voice: ${brief.voice ?? 'friendly, plain-spoken, expert'}.`,
    `Company: ${brief.company}\nWhat they sell: ${brief.whatTheySell}\nCompetitors: ${(brief.competitors ?? []).join(', ') || 'n/a'}\n\nThreads:\n${candidates
      .map((t) => `[${t.id}] (${t.community}) ${t.title}\n${t.body.slice(0, 600)}`)
      .join('\n\n')}\n\nReturn an array of {id, intent, why, reply} for every thread with intent >= 50.`,
    4000,
  );

  const byId = new Map(candidates.map((t) => [t.id, t]));
  return scored
    .filter((s) => byId.has(s.id) && s.intent >= 50)
    .sort((a, b) => b.intent - a.intent)
    .slice(0, top)
    .map((s) => ({ ...byId.get(s.id)!, intent: s.intent, why: s.why, reply: s.reply }));
}
