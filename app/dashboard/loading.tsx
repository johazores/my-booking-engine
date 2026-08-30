export default function DashboardLoading() {
  return (
    <main className="sf-dashboard-loading" aria-busy="true" aria-live="polite">
      <span className="sf-dashboard-loading__indicator" aria-hidden="true" />
      <div>
        <strong>Loading your workspace</strong>
        <span>Validating session, tenant access, and organization context.</span>
      </div>
    </main>
  );
}
