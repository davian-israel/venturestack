import { esc } from '../../mail/mailer';
import { ProductHandler } from '../types';
import { findIntent } from './intent';

export const agentReach: ProductHandler = {
  slug: 'agent-reach',
  schedule: '0 7 * * *', // daily 07:00 London
  onboardingFields: [
    { key: 'whatTheySell', label: 'What do you sell, in one sentence?', type: 'textarea', required: true },
    { key: 'keywords', label: 'Keywords buyers use (comma separated)', type: 'list', required: true },
    { key: 'competitors', label: 'Competitors (comma separated)', type: 'list' },
    { key: 'voice', label: 'Describe your brand voice, or paste a post you like', type: 'textarea' },
    { key: 'slackWebhook', label: 'Slack incoming webhook (optional)', type: 'url' },
  ],
  async run(ctx) {
    const threads = await findIntent({
      company: ctx.company ?? ctx.email.split('@')[1],
      whatTheySell: ctx.config.whatTheySell,
      keywords: ctx.config.keywords ?? [],
      competitors: ctx.config.competitors ?? [],
      voice: ctx.config.voice,
    });
    if (threads.length === 0) {
      return { title: 'No high-intent threads today', body: { threads: [] } };
    }

    if (ctx.config.slackWebhook) {
      await fetch(ctx.config.slackWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `*${threads.length} warm prospects today*\n` + threads.map((t, i) => `${i + 1}. <${t.url}|${t.title}> (${t.community})\n> ${t.reply}`).join('\n\n'),
        }),
      }).catch(() => undefined);
    }

    const html = `<h2>${threads.length} people asked for what you sell</h2>` +
      threads
        .map(
          (t, i) => `<div style="margin:16px 0;padding:12px;border:1px solid #ddd;border-radius:8px">
<b>${i + 1}. <a href="${esc(t.url)}">${esc(t.title)}</a></b><br><small>${esc(t.community)} · intent ${t.intent}/100 · ${esc(t.why)}</small>
<p style="background:#f6f6f6;padding:8px;border-radius:6px"><b>Suggested reply:</b> ${esc(t.reply)}</p></div>`,
        )
        .join('');
    return {
      title: `${threads.length} warm prospects — ${new Date().toLocaleDateString('en-GB')}`,
      body: { threads: threads.map(({ body, ...t }) => t) },
      emailHtml: html,
    };
  },
};
