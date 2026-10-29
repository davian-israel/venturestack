import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Venturestack — done-for-you business systems',
  description: 'Eight productized systems that find buyers, secure apps, recover cash and prove ROI — run for you.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site">
          <div className="wrap">
            <a className="brand" href="/">Venturestack</a>
            <nav>
              <a href="/#systems">Systems</a>
              <a href="/blog">Blog</a>
              <a href="/portal">Client portal</a>
            </nav>
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer className="site">
          <div className="wrap">© {new Date().getFullYear()} Venturestack · Payments by Stripe · <a href="/blog">Guides</a></div>
        </footer>
      </body>
    </html>
  );
}
