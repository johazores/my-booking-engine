export default function BrandingLoading() {
  return (
    <div className="sf-dashboard-loading" role="status" aria-live="polite">
      <span className="sf-dashboard-loading__indicator" aria-hidden="true" />
      <div><strong>Loading branding</strong><span>Checking tenant presentation settings.</span></div>
    </div>
  );
}
