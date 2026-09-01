import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { listIntegrations } from '@/server/integrations/integration-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const errors: Record<string, string> = {
  tenant: 'Choose an active organization before managing integrations.',
  permission: 'You do not have permission to manage integrations.',
  validation: 'Check the provider credentials and try again.',
  unavailable: 'That integration is not available in this organization.',
  lifecycle: 'That lifecycle change is not allowed. Disable an active integration before archiving it; archived integrations require fresh credentials.',
  'archive-confirmation': 'Confirm that stored credentials will be permanently removed before archiving this integration.',
  'health-auth': 'Stripe rejected the stored credentials. Rotate the secret key before using online payments.',
  'health-rate-limit': 'Stripe rate-limited the connection test. The stored credentials were not changed; try again later.',
  'health-unavailable': 'Stripe could not be reached for a definitive connection test. The stored credentials were not changed.',
  'health-invalid': 'Stripe returned an unexpected response to the connection test. The stored credentials were not changed.',
  server: 'The integration change could not be saved. Try again.',
};

const statuses: Record<string, string> = {
  saved: 'Stripe credentials saved securely and the integration is active.',
  enabled: 'Integration enabled without rotating stored credentials.',
  disabled: 'Integration disabled. Stored credentials were preserved.',
  archived: 'Integration archived and its stored credential ciphertext was permanently removed.',
  'health-ok': 'Stripe connection test passed. The stored secret key authenticated successfully.',
};

const capabilityLabels: Record<string, string> = {
  'payment-authorize': 'Payment authorization',
  'payment-capture': 'Payment capture',
  'payment-refund': 'Payment refunds',
  webhooks: 'Verified webhooks',
  'flight-search': 'Flight search',
  'hotel-search': 'Hotel search',
  availability: 'Availability',
  pricing: 'Pricing',
  reservation: 'Reservation',
  ticketing: 'Ticketing',
  modification: 'Modification',
  cancellation: 'Cancellation',
  refund: 'Refund',
};

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ status?: string; error?: string }> }) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated integrations guard returned without a session');

  const params = await searchParams;
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) {
    return (
      <section className="sf-integrations-empty" aria-labelledby="integrations-empty-title">
        <p className="sf-eyebrow">Provider integrations</p>
        <h1 id="integrations-empty-title">Select an organization first</h1>
        <p>Integrations are tenant-owned and are never loaded without an active, revalidated organization context.</p>
        <Link className="sf-button sf-button--primary" href="/account">Choose or create an organization</Link>
      </section>
    );
  }

  const authorization = await readOrganizationAuthorization({ organizationId: activeContext.organization.id, userId: session.user.id });
  const canRead = Boolean(authorization.platformAdmin || (authorization.role && organizationRoleHasPermission(authorization.role, 'integration:read')));
  const canManage = Boolean(authorization.platformAdmin || (authorization.role && organizationRoleHasPermission(authorization.role, 'integration:manage')));
  const integrations = canRead ? await listIntegrations({ organizationId: activeContext.organization.id, actorUserId: session.user.id }) : [];
  const stripe = integrations.find((integration) => integration.providerCode === 'stripe');

  if (!canRead) {
    return (
      <section className="sf-integrations-empty" aria-labelledby="integrations-denied-title">
        <p className="sf-eyebrow">Provider integrations</p>
        <h1 id="integrations-denied-title">Integration access is restricted</h1>
        <p>Your organization role does not include integration access. Ask an organization administrator if you need provider visibility.</p>
      </section>
    );
  }

  return (
    <div className="sf-integrations-page">
      <header className="sf-integrations-page__header">
        <div>
          <p className="sf-eyebrow">Provider integrations</p>
          <h1>{activeContext.organization.name}</h1>
          <p>Configure tenant-owned providers without exposing stored credentials to the browser.</p>
        </div>
        <span className="sf-integrations-page__count">{integrations.length} configured</span>
      </header>

      {params.status && statuses[params.status] ? <p className="sf-alert sf-alert--success" role="status">{statuses[params.status]}</p> : null}
      {params.error && errors[params.error] ? <p className="sf-alert sf-alert--error" role="alert">{errors[params.error]}</p> : null}

      <section className="sf-integration-card" aria-labelledby="stripe-integration-title">
        <div className="sf-integration-card__header">
          <div>
            <div className="sf-integration-card__title-row">
              <h2 id="stripe-integration-title">Stripe</h2>
              <span className={`sf-integration-status sf-integration-status--${stripe?.status === 'ACTIVE' ? 'active' : 'inactive'}`}>{stripe?.status ?? 'Not configured'}</span>
            </div>
            <p>Online payment authorization, capture and refunds, with verified webhook processing when a signing secret is configured.</p>
          </div>
          {stripe ? <span className="sf-integration-card__version">Credential version {stripe.credentialVersion}</span> : null}
        </div>

        {stripe ? (
          <div className="sf-integration-summary">
            <div><span>Display name</span><strong>{stripe.displayName}</strong></div>
            <div><span>Last updated</span><strong>{stripe.updatedAt.toLocaleString()}</strong></div>
            {stripe.archivedAt ? <div><span>Archived</span><strong>{stripe.archivedAt.toLocaleString()}</strong></div> : null}
            <div className="sf-integration-summary__wide"><span>Capabilities</span><div className="sf-integration-capabilities">{stripe.capabilities.map((capability) => <span key={capability}>{capabilityLabels[capability] ?? capability}</span>)}</div></div>
          </div>
        ) : <p className="sf-integration-card__empty">Stripe is not configured for this organization.</p>}

        {!canManage ? (
          <div className="sf-integration-readonly"><strong>Read only</strong><span>An organization administrator must configure credentials or change provider status.</span></div>
        ) : (
          <>
            {stripe?.status !== 'ARCHIVED' ? (
              <div className="sf-integration-lifecycle" aria-label="Stripe lifecycle and connection controls">
                {stripe?.status === 'ACTIVE' ? (
                  <>
                    <form action="/api/integrations/stripe/test" method="post">
                      <button className="sf-button sf-button--secondary" type="submit">Test Stripe connection</button>
                    </form>
                    <form action={`/api/integrations/${stripe.id}/status`} method="post">
                      <input type="hidden" name="action" value="disable" />
                      <button className="sf-button sf-button--secondary" type="submit">Disable Stripe</button>
                    </form>
                  </>
                ) : stripe ? (
                  <form action={`/api/integrations/${stripe.id}/status`} method="post">
                    <input type="hidden" name="action" value="enable" />
                    <button className="sf-button sf-button--primary" type="submit">Enable existing configuration</button>
                  </form>
                ) : null}
                {stripe ? <p>Connection tests make a read-only authenticated Stripe API request and never display account balances. Enable/disable preserves encrypted credentials; archiving permanently removes stored credential ciphertext.</p> : null}
              </div>
            ) : (
              <div className="sf-integration-readonly"><strong>Archived</strong><span>This record cannot be enabled. Enter fresh Stripe credentials below to reconnect the provider.</span></div>
            )}

            {stripe?.status === 'DISABLED' ? (
              <form className="sf-integration-archive" action={`/api/integrations/${stripe.id}/status`} method="post">
                <input type="hidden" name="action" value="archive" />
                <div>
                  <strong>Remove Stripe integration</strong>
                  <p>Archiving preserves the non-secret provider and audit history, but permanently deletes the stored encrypted credential envelope. Reconnection requires fresh credentials.</p>
                </div>
                <label className="sf-integration-archive__confirm"><input type="checkbox" name="confirm" value="archive" required /> I understand the stored credentials will be permanently removed.</label>
                <button className="sf-button sf-button--secondary" type="submit">Archive Stripe integration</button>
              </form>
            ) : null}

            <form className="sf-integration-form" action="/api/integrations/stripe" method="post">
              <div>
                <p className="sf-eyebrow">{stripe?.status === 'ARCHIVED' ? 'Reconnect provider' : stripe ? 'Rotate credentials' : 'Configure provider'}</p>
                <h3>{stripe?.status === 'ARCHIVED' ? 'Reconnect Stripe with fresh credentials' : stripe ? 'Replace Stripe credentials' : 'Connect Stripe'}</h3>
                <p>For security, existing secrets are never returned. Saving this form replaces the complete stored Stripe credential set and activates the integration.</p>
              </div>
              <label className="sf-field">Stripe secret key<input type="password" name="secretKey" required minLength={12} maxLength={4096} autoComplete="new-password" placeholder="sk_..." /><small>Server-side secret key only. Never enter card details or publishable keys here.</small></label>
              <label className="sf-field">Webhook signing secret <span className="sf-field__optional">optional</span><input type="password" name="webhookSecret" maxLength={4096} autoComplete="new-password" placeholder="whsec_..." /><small>Leave blank only if verified Stripe webhooks are intentionally not configured.</small></label>
              <button className="sf-button sf-button--primary" type="submit">{stripe?.status === 'ARCHIVED' ? 'Reconnect and activate Stripe' : stripe ? 'Rotate and activate credentials' : 'Save Stripe integration'}</button>
            </form>
          </>
        )}
      </section>

      {integrations.filter((integration) => integration.providerCode !== 'stripe').length > 0 ? (
        <section className="sf-integrations-other" aria-labelledby="other-integrations-title">
          <p className="sf-eyebrow">Other configured providers</p>
          <h2 id="other-integrations-title">Provider records</h2>
          <p>These records are shown safely without credentials. Provider-specific management controls are added only when SF has a real adapter and configuration contract.</p>
          <div className="sf-integrations-other__list">{integrations.filter((integration) => integration.providerCode !== 'stripe').map((integration) => <div key={integration.id}><strong>{integration.displayName}</strong><span>{integration.providerCode} · {integration.status}</span></div>)}</div>
        </section>
      ) : null}
    </div>
  );
}
