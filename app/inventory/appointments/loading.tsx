export default function AppointmentInventoryLoading() {
  return <div className="sf-inventory-page" aria-busy="true" aria-live="polite">
    <section className="sf-inventory-card">
      <p className="sf-eyebrow">Appointment inventory</p>
      <h1>Loading appointment inventory</h1>
      <p>Loading tenant-owned services, staff, service assignments, and weekly working hours.</p>
    </section>
  </div>;
}
