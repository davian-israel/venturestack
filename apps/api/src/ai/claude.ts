import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';

let client: Anthropic | undefined;

export function claudeAvailable(): boolean {
  return !!config.ANTHROPIC_API_KEY;
}

/** One-shot text completion. */
export async function ask(system: string, user: string, maxTokens = 1500): Promise<string> {
  if (!config.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  client ??= new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  const msg = await client.messages.create({
    model: config.ANTHROPIC_MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });
  return msg.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('\n')
    .trim();
}

/** Completion that must return JSON; tolerates code fences around it. */
export async function askJson<T>(system: string, user: string, maxTokens = 2000): Promise<T> {
  const text = await ask(`${system}\nRespond with JSON only, no prose.`, user, maxTokens);
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse(m ? m[1] : text) as T;
}
