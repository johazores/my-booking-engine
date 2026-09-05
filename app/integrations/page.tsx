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
  validation: 'Check the provider configuration and try again.',
  'travelport-validation': 'Check the Travelport environment and credentials, including the access group, and try again.',
  unavailable: 'That integration is not available in this organization.',
  lifecycle: 'That lifecycle change is not allowed. Disable an active integration before archiving it; archived integrations require fresh credentials.',
  'archive-confirmation': 'Confirm that stored credentials will be permanently removed before archiving this integration.',
  'health-auth': 'Stripe rejected the stored credentials. Rotate the secret key before using online payments.',
  'health-rate-limit': 'Stripe rate-limited the connection test. The stored credentials were not changed; try again later.',
  'health-unavailable': 'Stripe could not be reached for a definitive connection test. The stored credentials were not changed.',
  'health-invalid': 'Stripe returned an unexpected response to the connection test. The stored credentials were not changed.',
  'travelport-health-auth': 'Travelport rejected the stored TripServices credentials. Verify the environment, identity, client credentials, and access group before using supplier search.',
  'travelport-health-rate-limit': 'Travelport rate-limited the authentication test. Stored credentials were not changed; try again later.',
  'travelport-health-unavailable': 'Travelport could not be reached for a definitive authentication test. Stored credentials were not changed.',
  'travelport-health-invalid': 'Travelport returned an unexpected authentication response. Stored credentials were not changed.',
  server: 'The integration change could not be saved. Try again.',
};

const statuses: Record<string, string> = {
  saved: 'Stripe credentials saved securely and the integration is active.',
  'travelport-saved': 'Travelport Stays credentials saved securely and the hotel-search integration is active.',
  enabled: 'Integration enabled without rotating stored credentials.',
  disabled: 'Integration disabled. Stored credentials were preserved.',
  archived: 'Integration archived and its stored credential ciphertext was permanently removed.',
  'health-ok': 'Stripe connection test passed. The stored secret key authenticated successfully.',
  'travelport-health-ok': 'Travelport connection test passed. The stored TripServices credentials authenticated successfully.',
};

const healthLabels: Record<string, string> = {
  HEALTHY: 'Healthy',
  AUTHENTICATION_FAILED: 'Authentication failed',
  RATE_LIMITED: 'Rate limited',
  PROVIDER_UNAVAILABLE: 'Provider unavailable',
  INVALID_RESPONSE: 'Unexpected response',
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

type IntegrationRecord = Awaited<ReturnType<typeof listIntegrations>>[number];

function IntegrationSummary({ integration }: { integration: IntegrationRecord }) {
  return (
    <div className="sf-integration-summary">
      <div><span>Display name</span><strong>{integration.displayName}</strong></div>
      <div><span>Last updated</span><strong>{integration.updatedAt.toLocaleString()}</strong></div>
      <div>
        <span>Last connection test</span>
        <strong>{integration.lastHealthStatus ? healthLabels[integration.lastHealthStatus] ?? integration.lastHealthStatus : 'Not tested for current credentials'}</strong>
        {integration.lastHealthCheckedAt ? <small>{integration.lastHealthCheckedAt.toLocaleString()}</small> : null}
      </div>
      {integration.archivedAt ? <div><span>Archived</span><strong>{integration.archivedAt.toLocaleString()}</strong></div> : null}
      <div className="sf-integration-summary__wide"><span>Capabilities</span><div className="sf-integration-capabilities">{integration.capabilities.map((capability) => <span key={capability}>{capabilityLabels[capability] ?? capability}</span>)}</div></div>
    </div>
  );
}

function IntegrationLifecycleControls({
  integration,
  providerName,
  testAction,
  testLabel,
}: {
  integration: IntegrationRecord;
  providerName: string;
  testAction: string;
  testLabel: string;
}) {
  if (integration.status === 'ARCHIVED') {
    return <div className="sf-integration-readonly"><strong>Archived</strong><span>This record cannot be enabled. Enter fresh {providerName} credentials below to reconnect the provider.</span></div>;
  }

  return (
    <>
      <div className="sf-integration-lifecycle" aria-label={`${providerName} lifecycle and connection controls`}>
        {integration.status === 'ACTIVE' ? (
          <>
            <form action={testAction} method="post">
              <button className="sf-button sf-button--secondary" type="submit">{testLabel}</button>
            </form>
            <form action={`/api/integrations/${integration.id}/status`} method="post">
              <input type="hidden" name="action" value="disable" />
              <button className="sf-button sf-button--secondary" type="submit">Disable {providerName}</button>
            </form>
          </>
        ) : (
          <form action={`/api/integrations/${integration.id}/status`} method="post">
            <input type="hidden" name="action" value="enable" />
            <button className="sf-button sf-button--primary" type="submit">Enable existing configuration</button>
          </form>
        )}
        <p>Connection tests use the stored tenant-owned credentials without displaying provider data or secrets. The last result is shown only for the credential version actually tested. Enable/disable preserves encrypted credentials; archiving permanently removes stored credential ciphertext.</p>
      </div>
      {integration.status === 'DISABLED' ? (
        <form className="sf-integration-archive" action={`/api/integrations/${integration.id}/status`} method="post">
          <input type="hidden" name="action" value="archive" />
          <div>
            <strong>Remove {providerName} integration</strong>
            <p>Archiving preserves non-secret provider and audit history, but permanently deletes the stored encrypted credential envelope. Reconnection requires fresh credentials.</p>
          </div>
          <label className="sf-integration-archive__confirm"><input type="checkbox" name="confirm" value="archive" required /> I understand the stored credentials will be permanently removed.</label>
          <button className="sf-button sf-button--secondary" type="submit">Archive {providerName} integration</button>
        </form>
      ) : null}
    </>
  );
}

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
  const travelportStays = integrations.find((integration) => integration.providerCode === 'travelport-stays');

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

        {stripe ? <IntegrationSummary integration={stripe} /> : <p className="sf-integration-card__empty">Stripe is not configured for this organization.</p>}

        {!canManage ? (
          <div className="sf-integration-readonly"><strong>Read only</strong><span>An organization administrator must configure credentials or change provider status.</span></div>
        ) : (
          <>
            {stripe ? <IntegrationLifecycleControls integration={stripe} providerName="Stripe" testAction="/api/integrations/stripe/test" testLabel="Test Stripe connection" /> : null}
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

      <section className="sf-integration-card" aria-labelledby="travelport-stays-integration-title">
        <div className="sf-integration-card__header">
          <div>
            <div className="sf-integration-card__title-row">
              <h2 id="travelport-stays-integration-title">Travelport Stays</h2>
              <span className={`sf-integration-status sf-integration-status--${travelportStays?.status === 'ACTIVE' ? 'active' : 'inactive'}`}>{travelportStays?.status ?? 'Not configured'}</span>
            </div>
            <p>External hospitality supplier adapter. SF supports normalized hotel search, exact offer pricing and revalidation, plus server-side booking-rule and selected-offer authority review. Reservation, modification and cancellation remain unavailable until their provider write contracts are validated.</p>
          </div>
          {travelportStays ? <span className="sf-integration-card__version">Credential version {travelportStays.credentialVersion}</span> : null}
        </div>

        {travelportStays ? <IntegrationSummary integration={travelportStays} /> : <p className="sf-integration-card__empty">Travelport Stays is not configured for this organization.</p>}

        {!canManage ? (
          <div className="sf-integration-readonly"><strong>Read only</strong><span>An organization administrator must configure credentials or change provider status.</span></div>
        ) : (
          <>
            {travelportStays ? <IntegrationLifecycleControls integration={travelportStays} providerName="Travelport Stays" testAction="/api/integrations/travelport-stays/test" testLabel="Test Travelport authentication" /> : null}
            <form className="sf-integration-form" action="/api/integrations/travelport-stays" method="post">
              <div>
                <p className="sf-eyebrow">{travelportStays?.status === 'ARCHIVED' ? 'Reconnect provider' : travelportStays ? 'Rotate credentials' : 'Configure provider'}</p>
                <h3>{travelportStays?.status === 'ARCHIVED' ? 'Reconnect Travelport with fresh credentials' : travelportStays ? 'Replace Travelport credentials' : 'Connect Travelport Stays'}</h3>
                <p>Enter the complete TripServices credential set provisioned by Travelport. Existing credentials and environment are encrypted server-side and are never returned to the browser.</p>
              </div>
              <label className="sf-field">Environment<select name="environment" required defaultValue="pre-production"><option value="pre-production">Pre-production</option><option value="production">Production</option></select><small>Use the environment matching the identity and client credentials issued by Travelport.</small></label>
              <label className="sf-field">Travelport username<input type="password" name="username" required maxLength={512} autoComplete="new-password" /></label>
              <label className="sf-field">Travelport password<input type="password" name="password" required maxLength={4096} autoComplete="new-password" /></label>
              <label className="sf-field">Client ID<input type="password" name="clientId" required maxLength={512} autoComplete="new-password" /></label>
              <label className="sf-field">Client secret<input type="password" name="clientSecret" required maxLength={4096} autoComplete="new-password" /></label>
              <label className="sf-field">Access group<input type="password" name="accessGroup" required maxLength={512} autoComplete="new-password" /><small>Travelport requires the customer access group on Stays API calls. It remains server-only.</small></label>
              <button className="sf-button sf-button--primary" type="submit">{travelportStays?.status === 'ARCHIVED' ? 'Reconnect and activate Travelport' : travelportStays ? 'Rotate and activate credentials' : 'Save Travelport Stays integration'}</button>
            </form>
          </>
        )}
      </section>

      {integrations.filter((integration) => integration.providerCode !== 'stripe' && integration.providerCode !== 'travelport-stays').length > 0 ? (
        <section className="sf-integrations-other" aria-labelledby="other-integrations-title">
          <p className="sf-eyebrow">Other configured providers</p>
          <h2 id="other-integrations-title">Provider records</h2>
          <p>These records are shown safely without credentials. Provider-specific management controls are added only when SF has a real adapter and configuration contract.</p>
          <div className="sf-integrations-other__list">{integrations.filter((integration) => integration.providerCode !== 'stripe' && integration.providerCode !== 'travelport-stays').map((integration) => <div key={integration.id}><strong>{integration.displayName}</strong><span>{integration.providerCode} · {integration.status}</span></div>)}</div>
        </section>
      ) : null}
    </div>
  );
}
