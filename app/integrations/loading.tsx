export default function IntegrationsLoading() {
  return (
    <div className="sf-dashboard-loading" role="status" aria-live="polite">
      <span className="sf-dashboard-loading__indicator" aria-hidden="true" />
      <div><strong>Loading integrations</strong><span>Checking tenant provider configuration…</span></div>
    </div>
  );
}
