export default function TourInventoryLoading() {
  return <div className="sf-inventory-page" aria-busy="true" aria-live="polite">
    <section className="sf-inventory-card">
      <p className="sf-eyebrow">Tour inventory</p>
      <h1>Loading tours and packages</h1>
      <p>Loading tenant-owned products, departure schedules, capacity, and add-ons.</p>
    </section>
  </div>;
}
