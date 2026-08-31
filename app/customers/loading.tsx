export default function CustomersLoading() {
  return (
    <div className="sf-dashboard-loading" role="status" aria-live="polite">
      <span className="sf-dashboard-loading__indicator" aria-hidden="true" />
      <div><strong>Loading customers</strong><span>Checking tenant access and customer records.</span></div>
    </div>
  );
}
