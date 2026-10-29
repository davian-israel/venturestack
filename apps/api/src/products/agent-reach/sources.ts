import { config } from '../../config';

/**
 * Public-conversation sources for Agent Reach.
 * Only official / public APIs are used (Reddit OAuth API, HN Algolia, YouTube Data API).
 * LinkedIn and X are deliberately NOT scraped: their terms forbid it and accounts get banned.
 */

export interface Thread {
  source: 'reddit' | 'hn' | 'youtube';
  id: string;
  url: string;
  title: string;
  body: string;
  author: string;
  community: string;
  createdAt: Date;
}

const DAY = 86_400_000;

let redditToken: { token: string; exp: number } | undefined;
async function redditAuth(): Promise<string | undefined> {
  if (!config.REDDIT_CLIENT_ID || !config.REDDIT_CLIENT_SECRET) return undefined;
  if (redditToken && redditToken.exp > Date.now() + 60_000) return redditToken.token;
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.REDDIT_CLIENT_ID}:${config.REDDIT_CLIENT_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': config.REDDIT_USER_AGENT,
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`reddit auth ${res.status}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  redditToken = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return redditToken.token;
}

export async function searchReddit(query: string, days = 7): Promise<Thread[]> {
  const token = await redditAuth();
  if (!token) return [];
  const u = new URL('https://oauth.reddit.com/search');
  u.searchParams.set('q', query);
  u.searchParams.set('sort', 'new');
  u.searchParams.set('t', 'week');
  u.searchParams.set('limit', '50');
  u.searchParams.set('type', 'link');
  const res = await fetch(u, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': config.REDDIT_USER_AGENT } });
  if (!res.ok) return [];
  const j = (await res.json()) as { data: { children: { data: any }[] } };
  const since = Date.now() - days * DAY;
  return j.data.children
    .map((c) => c.data)
    .filter((d) => d.created_utc * 1000 >= since && !d.over_18)
    .map((d) => ({
      source: 'reddit' as const,
      id: `reddit:${d.id}`,
      url: `https://www.reddit.com${d.permalink}`,
      title: d.title,
      body: (d.selftext ?? '').slice(0, 1500),
      author: d.author,
      community: `r/${d.subreddit}`,
      createdAt: new Date(d.created_utc * 1000),
    }));
}

export async function searchHN(query: string, days = 7): Promise<Thread[]> {
  const since = Math.floor((Date.now() - days * DAY) / 1000);
  const u = new URL('https://hn.algolia.com/api/v1/search_by_date');
  u.searchParams.set('query', query);
  u.searchParams.set('tags', '(story,comment,ask_hn)');
  u.searchParams.set('numericFilters', `created_at_i>${since}`);
  u.searchParams.set('hitsPerPage', '30');
  const res = await fetch(u);
  if (!res.ok) return [];
  const j = (await res.json()) as { hits: any[] };
  return j.hits.map((h) => ({
    source: 'hn' as const,
    id: `hn:${h.objectID}`,
    url: `https://news.ycombinator.com/item?id=${h.objectID}`,
    title: h.title ?? h.story_title ?? '(comment)',
    body: String(h.comment_text ?? h.story_text ?? '').replace(/<[^>]+>/g, ' ').slice(0, 1500),
    author: h.author,
    community: 'Hacker News',
    createdAt: new Date(h.created_at),
  }));
}

export async function searchYouTubeComments(query: string, days = 7): Promise<Thread[]> {
  if (!config.YOUTUBE_API_KEY) return [];
  const u = new URL('https://www.googleapis.com/youtube/v3/search');
  u.searchParams.set('part', 'snippet');
  u.searchParams.set('q', query);
  u.searchParams.set('type', 'video');
  u.searchParams.set('order', 'date');
  u.searchParams.set('maxResults', '10');
  u.searchParams.set('publishedAfter', new Date(Date.now() - days * DAY).toISOString());
  u.searchParams.set('key', config.YOUTUBE_API_KEY);
  const res = await fetch(u);
  if (!res.ok) return [];
  const j = (await res.json()) as { items: any[] };
  return j.items.map((v) => ({
    source: 'youtube' as const,
    id: `yt:${v.id.videoId}`,
    url: `https://www.youtube.com/watch?v=${v.id.videoId}`,
    title: v.snippet.title,
    body: v.snippet.description ?? '',
    author: v.snippet.channelTitle,
    community: 'YouTube',
    createdAt: new Date(v.snippet.publishedAt),
  }));
}

export async function searchAll(queries: string[], days = 7): Promise<Thread[]> {
  const results = await Promise.allSettled(
    queries.flatMap((qy) => [searchReddit(qy, days), searchHN(qy, days), searchYouTubeComments(qy, days)]),
  );
  const seen = new Set<string>();
  const out: Thread[] = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const t of r.value) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
  }
  return out;
}
