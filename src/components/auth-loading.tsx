import { BrandMark } from './brand-mark';

export function AuthLoading({ label = 'Loading secure account' }: { label?: string }) {
  return (
    <main className="sf-auth-shell" aria-busy="true" aria-live="polite">
      <section className="sf-auth-card sf-auth-card--loading" aria-label={label}>
        <BrandMark />
        <div className="sf-auth-loading" role="status">
          <span className="sf-auth-loading__spinner" aria-hidden="true" />
          <div>
            <strong>{label}</strong>
            <p>Preparing the secure authentication flow.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
