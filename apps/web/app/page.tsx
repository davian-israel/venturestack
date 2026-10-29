import { JOBS, PRODUCTS, usd } from '@vs/catalog';

// An example night across three systems. Shown as an example, never as a client's real results.
const EXAMPLE = [
  { time: '03:04', system: 'Agent Reach', what: 'Found 5 people asking for an alternative to the tool you replace' },
  { time: '03:40', system: 'Agent Reach', what: 'Drafted a reply to each, in your voice' },
  { time: '04:10', system: 'AR Recovery', what: 'Sent pay-now reminders on 3 invoices over 14 days late' },
  { time: '05:30', system: 'KPI Dashboard', what: 'Refreshed cash, pipeline and ad spend from your accounts' },
  { time: '07:00', system: 'Morning report', what: 'Everything above, waiting in your inbox' },
];

export default function Home() {
  return (
    <>
      <section className="night hero bleed">
        <div className="wrap">
          <div>
            <h1>Your business, worked on overnight.</h1>
            <p className="lead">
              Eight done-for-you systems that find buyers, chase unpaid invoices and keep your numbers current.
              Each one runs while you sleep and reports to your inbox by 7:00.
            </p>
            <div className="actions">
              <a className="btn lamp" href="#systems">See the eight systems</a>
              <a className="btn secondary" href="/p/agent-reach">Start with Agent Reach</a>
            </div>
          </div>
          <figure className="report" aria-label="An example of a morning report" style={{ margin: 0 }}>
            <div className="report-head">
              <strong>Your morning report</strong>
              <span>Example night</span>
            </div>
            <ol>
              {EXAMPLE.map((e) => (
                <li key={e.time + e.what}>
                  <time>{e.time}</time>
                  <span className="dot" aria-hidden />
                  <span className="what"><b>{e.system}.</b> {e.what}</span>
                </li>
              ))}
            </ol>
            <figcaption className="note">Illustration of a typical night. Your report shows your own results.</figcaption>
          </figure>
        </div>
      </section>

      <section id="systems" aria-labelledby="systems-h">
        <h2 id="systems-h">Pick the job you want done</h2>
        <p className="lead">Start with one. Each system is set up for you and runs on its own after a two-minute form.</p>
        <div className="index">
          {JOBS.map((job) => (
            <div className="job" key={job.id}>
              <div className="job-title">
                <h3>{job.title}</h3>
                <p>{job.blurb}</p>
              </div>
              <ul className="offers">
                {PRODUCTS.filter((p) => p.job === job.id).map((p) => (
                  <li key={p.slug}>
                    <a className="offer" href={`/p/${p.slug}`}>
                      <span className="offer-name">{p.name}</span>
                      <span className="offer-line">{p.tagline}</span>
                      <span className="offer-price"><b>{usd(p.monthlyCents)}/mo</b><span>{usd(p.setupFeeCents)} setup</span></span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="how-h">
        <h2 id="how-h">How it starts</h2>
        <ol className="steps">
          <li><h3>Pay with Stripe</h3><p>Setup fee and first month in one payment. Cancel any time from your billing page.</p></li>
          <li><h3>Answer a two-minute form</h3><p>Tell us what you sell, who you sell to and which accounts to connect.</p></li>
          <li><h3>Read the morning report</h3><p>The system runs every night. Results land in your inbox and your portal.</p></li>
        </ol>
      </section>

      <section className="plain" aria-labelledby="plain-h">
        <h2 id="plain-h">What you are buying</h2>
        <div className="cols">
          <p>Each system is built on proven open-source software: Metabase, Paperless-ngx, Invoice Ninja, Dub and others. We set it up, connect it to your accounts and run it for you, so you get the result without hiring anyone or learning a new tool.</p>
          <p>Your data stays yours. Systems that store your records run on their own private server, and everything is deleted 30 days after you cancel. Security audits only read code you give us access to.</p>
        </div>
      </section>
    </>
  );
}
