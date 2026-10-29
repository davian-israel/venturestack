import { PRODUCTS, usd } from '@vs/catalog';

export default function Home() {
  return (
    <>
      <h1>Business systems that run themselves.</h1>
      <p className="lead">
        Eight done-for-you systems built on proven open-source software. Pick the one that fixes your biggest leak — we set it up and run it every day.
      </p>
      <div className="grid" id="systems">
        {PRODUCTS.map((p) => (
          <a key={p.slug} href={`/p/${p.slug}`} className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
            <h3>{p.name}</h3>
            <p>{p.tagline}</p>
            <div className="price">{usd(p.setupFeeCents)} setup · {usd(p.monthlyCents)}/mo</div>
          </a>
        ))}
      </div>
    </>
  );
}
