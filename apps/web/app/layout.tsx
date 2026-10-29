import '@fontsource-variable/bricolage-grotesque/standard.css';
import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Venturestack — systems that work overnight for your business',
  description: 'Eight done-for-you systems that find buyers, chase unpaid invoices and keep your numbers current. They run at night and report by 7:00.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip">Skip to content</a>
        <header className="site">
          <div className="wrap">
            <a className="brand" href="/">Venturestack</a>
            <nav aria-label="Main">
              <a href="/#systems">Systems</a>
              <a href="/blog">Guides</a>
              <a href="/portal">Sign in</a>
            </nav>
          </div>
        </header>
        <main id="main" className="wrap">{children}</main>
        <footer className="site">
          <div className="wrap">
            © {new Date().getFullYear()} Venturestack. Payments are handled by Stripe. <a href="/blog">Read the guides</a>
          </div>
        </footer>
      </body>
    </html>
  );
}
