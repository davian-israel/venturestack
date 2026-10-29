import { notFound } from 'next/navigation';
import { PRODUCTS, bySlug, usd } from '@vs/catalog';
import BuyButton from './BuyButton';

export function generateStaticParams() {
  return PRODUCTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const p = bySlug((await params).slug);
  return p ? { title: `${p.name} — ${p.tagline}`, description: p.tagline } : {};
}

export default async function ProductPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ cancelled?: string }> }) {
  const p = bySlug((await params).slug);
  if (!p) notFound();
  const cancelled = (await searchParams).cancelled;
  return (
    <>
      <h1>{p.name}</h1>
      <p className="lead">{p.tagline}</p>
      {cancelled && <p className="notice">Checkout cancelled — nothing was charged.</p>}
      <h2>Who it's for</h2>
      <p>{p.audience}.</p>
      <h2>What you get</h2>
      <ul className="ticks">{p.deliverables.map((d) => <li key={d}>{d}</li>)}</ul>
      <h2>How it works</h2>
      <ol>
        <li>Pay securely with Stripe.</li>
        <li>Answer a 2-minute setup form in your portal.</li>
        <li>We run it for you from then on; results arrive by email and in your portal.</li>
      </ol>
      <div className="card" style={{ maxWidth: 420, marginTop: 28 }}>
        <div className="price" style={{ fontSize: 22 }}>{usd(p.setupFeeCents)} setup + {usd(p.monthlyCents)}/month</div>
        <p className="muted">Cancel any time from your billing page.</p>
        <BuyButton slug={p.slug} label={`Start ${p.name}`} />
        {p.oneOffCents && (
          <div style={{ marginTop: 12 }}>
            <BuyButton slug={p.slug} oneOff label={`One-off audit only — ${usd(p.oneOffCents)}`} secondary />
          </div>
        )}
      </div>
      <p className="muted" style={{ marginTop: 24, fontSize: 14 }}>Built on {p.ossBase} (open source).</p>
    </>
  );
}
