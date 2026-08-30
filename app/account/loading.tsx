export default function AccountLoading() {
  return (
    <div className="sf-dashboard-loading" aria-busy="true" aria-live="polite" role="status">
      <span className="sf-dashboard-loading__indicator" aria-hidden="true" />
      <div>
        <strong>Loading account administration</strong>
        <span>Validating session, tenant access, and organization permissions.</span>
      </div>
    </div>
  );
}
