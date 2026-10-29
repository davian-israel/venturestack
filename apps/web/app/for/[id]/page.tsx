import { notFound } from 'next/navigation';
import { usd } from '@vs/catalog';
import { apiGet } from '@/lib/api';

export const metadata = { robots: { index: false } };

export default async function Proof({ params }: { params: Promise<{ id: string }> }) {
  const data = await apiGet<{ company: string; product: any; proof: any }>(`/proof/${(await params).id}`);
  if (!data) notFound();
  const { company, product, proof } = data;
  return (
    <>
      <h1>Prepared for {company}</h1>
      <p className="lead">{product.tagline}</p>
      {proof.kind === 'threads' ? (
        <>
          <h2>People asking for what you sell — last 7 days</h2>
          {proof.threads.map((t: any) => (
            <div className="thread" key={t.id}>
              <a href={t.url} target="_blank" rel="noreferrer">{t.title}</a> <span className="muted">({t.community})</span>
              <blockquote><b>Suggested reply:</b> {t.reply}</blockquote>
            </div>
          ))}
        </>
      ) : (
        <>
          <h2>{proof.headline}</h2>
          {proof.sections?.map((s: any) => (
            <div key={s.title} className="card" style={{ marginBottom: 12 }}>
              <h3>{s.title}</h3>
              <ul>{s.points.map((p: string) => <li key={p}>{p}</li>)}</ul>
            </div>
          ))}
          <p className="muted">This is a sample built from public information; your real version is tailored after a 2-minute setup.</p>
        </>
      )}
      <p style={{ marginTop: 28 }}><a className="btn" href={`/p/${product.slug}`}>Get this every {product.slug === 'agent-reach' ? 'morning' : 'month'} — {usd(product.monthlyCents)}/mo</a></p>
    </>
  );
}
