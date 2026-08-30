import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { readOrganizationBranding } from '@/server/branding/branding-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const errors: Record<string, string> = {
  tenant: 'Choose an active organization before managing branding.',
  permission: 'You do not have permission to manage organization branding.',
  domain: 'That custom domain is already assigned to another organization.',
  validation: 'Check the branding and contact fields and try again.',
  server: 'Branding settings could not be saved. Try again.',
};

export default async function BrandingPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated branding guard returned without a session');

  const params = await searchParams;
  const activeContext = await readActiveOrganizationContext(session.user.id);
  const authorization = activeContext.organization
    ? await readOrganizationAuthorization({ organizationId: activeContext.organization.id, userId: session.user.id })
    : null;
  const canManage = Boolean(
    authorization?.platformAdmin ||
    (authorization?.role && organizationRoleHasPermission(authorization.role, 'organization-settings:manage')),
  );
  const branding = activeContext.organization
    ? await readOrganizationBranding({ organizationId: activeContext.organization.id, userId: session.user.id })
    : null;

  if (!activeContext.organization || !branding) {
    return (
      <section className="sf-branding-empty" aria-labelledby="branding-empty-title">
        <p className="sf-eyebrow">White-label branding</p>
        <h1 id="branding-empty-title">Select an organization first</h1>
        <p>Branding is tenant-owned and is never loaded without an active, revalidated organization context.</p>
        <Link className="sf-button sf-button--primary" href="/account">Choose or create an organization</Link>
      </section>
    );
  }

  return (
    <div className="sf-branding-page">
      <header className="sf-branding-page__header">
        <div>
          <p className="sf-eyebrow">White-label branding</p>
          <h1>{activeContext.organization.name}</h1>
          <p>Control the tenant presentation used by the authenticated workspace and future customer-facing delivery surfaces.</p>
        </div>
        <Link className="sf-button sf-button--secondary" href="/account">Organization settings</Link>
      </header>

      {params.status === 'updated' ? <p className="sf-alert sf-alert--success" role="status">Branding settings updated and audited.</p> : null}
      {params.error && errors[params.error] ? <p className="sf-alert sf-alert--error" role="alert">{errors[params.error]}</p> : null}

      <section className="sf-branding-preview" aria-labelledby="branding-preview-title">
        <div className="sf-branding-preview__identity">
          {branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="sf-branding-preview__logo" src={branding.logoUrl} alt={`${branding.name} logo`} />
          ) : <span className="sf-branding-preview__fallback">SF</span>}
          <div><span>Current tenant identity</span><strong id="branding-preview-title">{branding.name}</strong><small>{branding.customDomain ?? branding.slug}</small></div>
        </div>
        <div className="sf-branding-preview__swatches" aria-label="Brand colors">
          <span style={{ background: branding.primaryColor }} title={`Primary ${branding.primaryColor}`} />
          <span style={{ background: branding.secondaryColor }} title={`Secondary ${branding.secondaryColor}`} />
          <span style={{ background: branding.accentColor }} title={`Accent ${branding.accentColor}`} />
        </div>
      </section>

      {!canManage ? (
        <section className="sf-account-panel">
          <p className="sf-eyebrow">Read only</p>
          <h2>Branding is visible but not editable</h2>
          <p className="sf-auth-card__copy">An organization administrator with settings permission must make branding changes.</p>
        </section>
      ) : (
        <form className="sf-branding-form" action="/api/organizations/branding" method="post">
          <section className="sf-branding-card" aria-labelledby="visual-brand-title">
            <p className="sf-eyebrow">Visual identity</p>
            <h2 id="visual-brand-title">Logo, colors and typography</h2>
            <p>Saved colors are applied through CSS design tokens in the authenticated workspace instead of tenant-specific component overrides.</p>
            <div className="sf-form">
              <label className="sf-field">Logo URL<input type="url" name="logoUrl" defaultValue={branding.logoUrl ?? ''} placeholder="https://cdn.example.com/logo.svg" maxLength={2048} /><small>HTTPS only. Leave blank to use the SF fallback mark.</small></label>
              <label className="sf-field">Favicon URL<input type="url" name="faviconUrl" defaultValue={branding.faviconUrl ?? ''} placeholder="https://cdn.example.com/favicon.ico" maxLength={2048} /><small>Used by authenticated workspace metadata when configured.</small></label>
              <div className="sf-branding-color-grid">
                <label className="sf-field">Primary color<input type="color" name="primaryColor" defaultValue={branding.primaryColor} /></label>
                <label className="sf-field">Secondary color<input type="color" name="secondaryColor" defaultValue={branding.secondaryColor} /></label>
                <label className="sf-field">Accent color<input type="color" name="accentColor" defaultValue={branding.accentColor} /></label>
              </div>
              <label className="sf-field">Font family<select name="fontFamily" defaultValue={branding.fontFamily}><option value="INTER">Inter / modern sans</option><option value="SYSTEM">System sans</option><option value="SERIF">Serif</option><option value="MONO">Monospace</option></select></label>
            </div>
          </section>

          <section className="sf-branding-card" aria-labelledby="contact-brand-title">
            <p className="sf-eyebrow">Business contact</p>
            <h2 id="contact-brand-title">Contact information</h2>
            <div className="sf-form">
              <label className="sf-field">Contact email<input type="email" name="contactEmail" defaultValue={branding.contactEmail ?? ''} maxLength={320} autoComplete="email" /></label>
              <label className="sf-field">Contact phone<input type="tel" name="contactPhone" defaultValue={branding.contactPhone ?? ''} maxLength={40} autoComplete="tel" /></label>
              <label className="sf-field">Website URL<input type="url" name="websiteUrl" defaultValue={branding.websiteUrl ?? ''} placeholder="https://example.com" maxLength={2048} /></label>
            </div>
          </section>

          <section className="sf-branding-card" aria-labelledby="email-brand-title">
            <p className="sf-eyebrow">Email branding</p>
            <h2 id="email-brand-title">Sender presentation</h2>
            <p>These values are persisted now so future provider adapters can consume tenant-owned sender identity without hardcoded configuration.</p>
            <div className="sf-form-row">
              <label className="sf-field">Sender name<input name="emailFromName" defaultValue={branding.emailFromName ?? ''} maxLength={160} /></label>
              <label className="sf-field">Reply-to email<input type="email" name="emailReplyTo" defaultValue={branding.emailReplyTo ?? ''} maxLength={320} /></label>
            </div>
          </section>

          <section className="sf-branding-card" aria-labelledby="public-brand-title">
            <p className="sf-eyebrow">Public booking presentation</p>
            <h2 id="public-brand-title">Customer-facing copy</h2>
            <p>The values are stored behind a public-safe branding reader. They will be consumed by the real booking journey when that dependency is implemented; no placeholder booking page is created here.</p>
            <div className="sf-form">
              <label className="sf-field">Booking page title<input name="publicBookingTitle" defaultValue={branding.publicBookingTitle ?? ''} maxLength={160} /></label>
              <label className="sf-field">Booking page description<textarea name="publicBookingDescription" defaultValue={branding.publicBookingDescription ?? ''} maxLength={500} rows={4} /></label>
            </div>
          </section>

          <section className="sf-branding-card" aria-labelledby="domain-brand-title">
            <p className="sf-eyebrow">Custom domain</p>
            <h2 id="domain-brand-title">Domain configuration</h2>
            <p>Store the intended booking hostname now. DNS ownership verification and traffic routing must be completed before a custom domain is considered live.</p>
            <label className="sf-field">Hostname<input name="customDomain" defaultValue={branding.customDomain ?? ''} placeholder="book.example.com" maxLength={253} inputMode="url" /><small>Hostname only—no protocol, path or port.</small></label>
          </section>

          <div className="sf-branding-form__actions">
            <button className="sf-button sf-button--primary" type="submit">Save branding settings</button>
            <span>Business name remains managed in <Link href="/account">organization settings</Link>.</span>
          </div>
        </form>
      )}
    </div>
  );
}
