import { config } from '../../config';
import { ProductHandler } from '../types';

/**
 * Spanish Channel in a Box. Picks the client's best-performing videos that are not yet dubbed
 * and sends them to the Voice Studio GPU worker (Railway has no GPUs). The GPU worker transcribes,
 * translates, clones the voice (consent is checked before this handler ever runs), renders subtitles
 * and uploads to the Spanish channel with the client's OAuth token, then calls back /webhooks/voice.
 */
const MONTHLY_CAP = 8;

export const voiceStudio: ProductHandler = {
  slug: 'voice-studio',
  schedule: '0 5 * * 1', // Mondays: queue 2 videos/week ≈ 8/month
  onboardingFields: [
    { key: 'sourceChannelId', label: 'Your English YouTube channel ID', type: 'text', required: true },
    { key: 'spanishChannelRefreshToken', label: 'Connect your Spanish channel (OAuth)', type: 'secret', required: true },
    { key: 'voiceSampleUrl', label: 'Link to 2+ minutes of clean voice audio', type: 'url', required: true },
  ],
  async run(ctx) {
    if (!config.YOUTUBE_API_KEY) throw new Error('YOUTUBE_API_KEY not set');
    if (!config.GPU_DUB_ENDPOINT) throw new Error('GPU_DUB_ENDPOINT not set — choose a GPU provider for Voice Studio');

    const done: string[] = ctx.config.dubbedVideoIds ?? [];
    const month = new Date().toISOString().slice(0, 7);
    const usedThisMonth = ctx.config.usage?.[month] ?? 0;
    const room = Math.min(2, MONTHLY_CAP - usedThisMonth);
    if (room <= 0) return null;

    const u = new URL('https://www.googleapis.com/youtube/v3/search');
    u.searchParams.set('part', 'id');
    u.searchParams.set('channelId', ctx.config.sourceChannelId);
    u.searchParams.set('order', 'viewCount');
    u.searchParams.set('type', 'video');
    u.searchParams.set('maxResults', '50');
    u.searchParams.set('key', config.YOUTUBE_API_KEY);
    const res = await fetch(u);
    if (!res.ok) throw new Error(`YouTube ${res.status}`);
    const ids: string[] = ((await res.json()) as any).items.map((i: any) => i.id.videoId);
    const next = ids.filter((id) => !done.includes(id)).slice(0, room);
    if (next.length === 0) return null;

    for (const videoId of next) {
      const r = await fetch(config.GPU_DUB_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.GPU_DUB_TOKEN ?? ''}` },
        body: JSON.stringify({
          tenantId: ctx.tenantId,
          videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
          targetLanguage: 'es',
          voiceSampleUrl: ctx.config.voiceSampleUrl,
          consentRecord: ctx.config.consent,
          uploadRefreshToken: ctx.config.spanishChannelRefreshToken,
          callbackUrl: `${config.PUBLIC_API_URL}/webhooks/voice`,
        }),
      });
      if (!r.ok) throw new Error(`GPU worker ${r.status}`);
    }

    return {
      title: `${next.length} videos queued for Spanish dubbing`,
      body: {
        queued: next,
        configPatch: { dubbedVideoIds: [...done, ...next], usage: { ...(ctx.config.usage ?? {}), [month]: usedThisMonth + next.length } },
      },
    };
  },
};
