import { notFound } from 'next/navigation';
import { PRODUCTS, bySlug, usd } from '@vs/catalog';
import BuyButton from './BuyButton';
import Tracker from './Tracker';

export function generateStaticParams() {
  return PRODUCTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const p = bySlug((await params).slug);
  return p ? { title: `${p.name} — Venturestack`, description: p.tagline } : {};
}

export default async function ProductPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ cancelled?: string }> }) {
  const p = bySlug((await params).slug);
  if (!p) notFound();
  const cancelled = (await searchParams).cancelled;
  return (
    <>
      <Tracker product={p.slug} />
      <section className="night product-hero bleed">
        <div className="wrap">
          <h1 style={{ color: '#fff' }}>{p.name}</h1>
          <p className="lead" style={{ color: 'var(--on-night-dim)' }}>{p.tagline}</p>
          <p className="meta">{p.cadence}</p>
        </div>
      </section>

      <div className="product-body">
        <div className="section-light">
          {cancelled && <p className="notice" style={{ marginTop: 56 }}>Checkout was cancelled. You have not been charged.</p>}

          <h2>What you get</h2>
          <ul className="ticks">{p.deliverables.map((d) => <li key={d}>{d}</li>)}</ul>

          <h2>What a night looks like</h2>
          <div className="example">
            <figure className="report" aria-label={`Example night for ${p.name}`}>
              <div className="report-head"><strong>{p.name}</strong><span>Example</span></div>
              <ol>
                {p.sample.map((s) => (
                  <li key={s.time + s.line}>
                    <time>{s.time}</time>
                    <span className="dot" aria-hidden />
                    <span className="what">{s.line}</span>
                  </li>
                ))}
              </ol>
            </figure>
          </div>

          <h2>Who it is for</h2>
          <p>{p.audience}.</p>

          <h2>How it starts</h2>
          <ol className="steps compact">
            <li><h3>Pay with Stripe</h3><p>{usd(p.setupFeeCents)} setup and your first month in one payment.</p></li>
            <li><h3>Answer a two-minute form</h3><p>We email you a link to your portal straight after payment.</p></li>
            <li><h3>It runs on its own</h3><p>{p.cadence}. Results arrive by email and in your portal.</p></li>
          </ol>
          <p className="muted" style={{ marginTop: 32, fontSize: '0.95rem' }}>Built on {p.ossBase}, open-source software we set up and run for you.</p>
        </div>

        <aside className="buy" aria-label="Pricing">
          <div className="amount">{usd(p.monthlyCents)}<small> /month</small></div>
          <p className="setup">plus {usd(p.setupFeeCents)} one-time setup</p>
          <BuyButton slug={p.slug} label={`Start ${p.name}`} />
          {p.oneOffCents && (
            <div style={{ marginTop: 10 }}>
              <BuyButton slug={p.slug} oneOff label={`One audit only, ${usd(p.oneOffCents)}`} secondary />
            </div>
          )}
          <p className="fine">Secure checkout by Stripe. Cancel any time from your billing page; your service stops at the end of the paid month.</p>
        </aside>
      </div>
    </>
  );
}
