import { askJson } from '../../ai/claude';
import { esc } from '../../mail/mailer';
import { ProductHandler } from '../types';

/**
 * Code-level audit of an AI-built app. Reads the repository the client authorised
 * (read-only GitHub token) — it never probes the live app.
 */
export const PHASES = [
  'Secrets exposure: API keys, service-role keys, tokens committed or shipped to the browser bundle',
  'Authentication and session handling',
  'Authorisation and data access: row-level security, open tables/buckets, IDOR',
  'Input handling: injection, XSS, SSRF, unsafe file upload',
  'Business-logic flaws: payment bypass, plan limits enforced only client-side, race conditions',
  'Dependencies and configuration: vulnerable packages, CORS, debug modes, exposed admin routes',
] as const;

const INTERESTING = /(\.env|config|supabase|firebase|prisma|schema|middleware|auth|api\/|server|route|policy|rls|\.sql$|package\.json$|next\.config|vite\.config)/i;

async function gh(path: string, token: string) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'venturestack-audit' },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`);
  return res.json() as Promise<any>;
}

export const securityAudit: ProductHandler = {
  slug: 'security-audit',
  schedule: '0 4 * * *', // daily check for a new release; audits only when the tag changed
  onboardingFields: [
    { key: 'repo', label: 'GitHub repository (owner/name)', type: 'text', required: true },
    { key: 'githubToken', label: 'Fine-grained GitHub token with read-only Contents access to that repo', type: 'secret', required: true },
    { key: 'appUrl', label: 'Live app URL (for the report only; we do not test it)', type: 'url' },
  ],
  async run(ctx) {
    const { repo, githubToken } = ctx.config;
    const meta = await gh(`/repos/${repo}`, githubToken);
    let ref = meta.default_branch as string;
    try {
      const rel = await gh(`/repos/${repo}/releases/latest`, githubToken);
      ref = rel.tag_name;
    } catch {
      /* no releases: audit default branch */
    }
    const head = await gh(`/repos/${repo}/commits/${encodeURIComponent(ref)}`, githubToken);
    if (ctx.config.lastAuditedSha === head.sha) return null; // nothing new to audit

    const tree = await gh(`/repos/${repo}/git/trees/${head.sha}?recursive=1`, githubToken);
    const files = (tree.tree as any[])
      .filter((f) => f.type === 'blob' && f.size < 60_000 && INTERESTING.test(f.path) && !f.path.includes('node_modules'))
      .slice(0, 60);
    const contents: string[] = [];
    let budget = 180_000;
    for (const f of files) {
      const blob = await gh(`/repos/${repo}/git/blobs/${f.sha}`, githubToken);
      const text = Buffer.from(blob.content, 'base64').toString('utf8');
      if (text.length > budget) break;
      budget -= text.length;
      contents.push(`--- ${f.path}\n${text}`);
    }

    const findings = await askJson<{ phase: number; severity: 'critical' | 'high' | 'medium' | 'low'; title: string; file: string; explanation: string; fix: string }[]>(
      `You are a senior application-security reviewer auditing an app built with an AI coding tool, for a non-technical founder.
Work through these 6 phases in order and report concrete findings only (no generic advice):
${PHASES.map((p, i) => `${i + 1}. ${p}`).join('\n')}
Explain each finding in plain English and give a specific fix. Never include the value of any secret you find — name the file and variable only.`,
      `Repository ${repo} at ${ref} (${head.sha.slice(0, 7)}).\n\n${contents.join('\n\n')}`,
      8000,
    );

    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    findings.sort((a, b) => order[a.severity] - order[b.severity]);
    const html = `<h2>Security audit — ${esc(repo)} @ ${esc(ref)}</h2>
<p>${findings.filter((f) => f.severity === 'critical' || f.severity === 'high').length} critical/high issues, ${findings.length} in total.</p>` +
      findings
        .map((f) => `<h3>[${f.severity.toUpperCase()}] ${esc(f.title)}</h3><p><i>Phase ${f.phase} · ${esc(f.file)}</i></p><p>${esc(f.explanation)}</p><p><b>Fix:</b> ${esc(f.fix)}</p>`)
        .join('');

    return {
      title: `Security audit: ${repo} @ ${ref}`,
      body: { repo, ref, sha: head.sha, findings, configPatch: { lastAuditedSha: head.sha } },
      emailHtml: html,
    };
  },
};
