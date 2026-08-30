import Link from 'next/link';

import { BrandMark } from '@/components/brand-mark';

const capabilities = [
  {
    title: 'Normalized booking domain',
    copy: 'Internal booking concepts stay independent from GDS, payment, email, and other provider-specific APIs.',
  },
  {
    title: 'Tenant-first security',
    copy: 'Organization ownership is designed into server-side data access instead of relying on interface filters.',
  },
  {
    title: 'Internal + external inventory',
    copy: 'The architecture can grow from first-party availability into supplier and GDS inventory without replacing the core domain.',
  },
];

const foundation = [
  'Next.js 16.3.3 and React 19.2.8 foundation',
  'Strict TypeScript 6.0.3 configuration',
  'Prisma 7.10 with PostgreSQL driver adapter',
  'Organization, membership, credential, and session schema',
  'Tenant-scoped organization repository',
  'First-party email/password authentication with opaque server sessions',
];

export default function HomePage() {
  return (
    <main>
      <header className="sf-header">
        <div className="sf-container sf-header__inner">
          <BrandMark />
          <nav className="sf-header__nav" aria-label="Primary navigation">
            <a className="sf-header__link" href="#foundation">Foundation</a>
            <Link className="sf-header__link" href="/sign-in">Sign in</Link>
            <Link className="sf-button sf-button--primary sf-button--compact" href="/sign-up">Create account</Link>
          </nav>
        </div>
      </header>

      <section className="sf-hero">
        <div className="sf-container sf-hero__grid">
          <div>
            <p className="sf-eyebrow">Commercial booking infrastructure</p>
            <h1>One booking foundation built to serve many reservation businesses.</h1>
            <p className="sf-hero__copy">
              SF is being built as a real multitenant platform for hotels, resorts, travel agencies,
              tours, appointments, rentals, marketplaces, and future booking models.
            </p>
            <div className="sf-actions">
              <Link className="sf-button sf-button--primary" href="/sign-up">Create account</Link>
              <Link className="sf-button sf-button--secondary" href="/sign-in">Sign in</Link>
            </div>
          </div>

          <div className="sf-system-card" aria-label="SF platform architecture summary">
            <div className="sf-system-card__topline">
              <span>SF core</span>
              <span className="sf-status">foundation</span>
            </div>
            <div className="sf-system-card__flow">
              <div>Application</div><span>↓</span>
              <div>Booking domain</div><span>↓</span>
              <div>Provider contracts</div><span>↓</span>
              <div>Internal inventory · GDS · Payments</div>
            </div>
          </div>
        </div>
      </section>

      <section className="sf-section" id="architecture">
        <div className="sf-container">
          <div className="sf-section__heading"><p className="sf-eyebrow">Architecture</p><h2>Designed for real booking workflows, not prototype screens.</h2></div>
          <div className="sf-card-grid">
            {capabilities.map((capability) => <article className="sf-card" key={capability.title}><h3>{capability.title}</h3><p>{capability.copy}</p></article>)}
          </div>
        </div>
      </section>

      <section className="sf-section sf-section--muted" id="foundation">
        <div className="sf-container sf-foundation">
          <div>
            <p className="sf-eyebrow">Current build</p>
            <h2>Security foundations before commercial workflows.</h2>
            <p>Authentication and tenant-safe membership reads are now connected. Booking, payments, inventory, and supplier integrations continue in dependency order rather than being represented by fake workflows.</p>
          </div>
          <ul className="sf-check-list">{foundation.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      </section>

      <footer className="sf-footer"><div className="sf-container sf-footer__inner"><BrandMark /><p>Production booking infrastructure, built dependency first.</p></div></footer>
    </main>
  );
}
