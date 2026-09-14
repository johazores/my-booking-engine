import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repositoryRoot = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, repositoryRoot), 'utf8');
}

test('Prisma config and drift validation use the complete multi-file schema directory', async () => {
  const [config, packageSource] = await Promise.all([
    source('prisma.config.ts'),
    source('package.json'),
  ]);
  const packageJson = JSON.parse(packageSource);
  const driftCommand = packageJson.scripts?.['db:drift'];

  assert.match(config, /schema:\s*['"]prisma\/?['"]/);
  assert.equal(
    driftCommand,
    'prisma migrate diff --from-schema prisma --to-config-datasource --exit-code',
  );
  assert.doesNotMatch(driftCommand, /prisma\/schema\.prisma/);
  assert.equal(
    packageJson.scripts?.validate,
    'npm run prisma:validate && npm run prisma:generate && npm run typecheck && npm run lint && npm run test && npm run build',
  );
});

test('non-hospitality tenant-root foreign keys are represented in Prisma drift authority', async () => {
  const [rootSchema, tourSchema, appointmentSchema, rentalSchema, tourMigration, appointmentMigration, rentalIntegrityMigration] =
    await Promise.all([
      source('prisma/schema.prisma'),
      source('prisma/tour-inventory.prisma'),
      source('prisma/appointment-inventory.prisma'),
      source('prisma/rental-inventory.prisma'),
      source('prisma/migrations/20260914122000_tour_inventory_foundation/migration.sql'),
      source('prisma/migrations/20260914130000_appointment_inventory_foundation/migration.sql'),
      source('prisma/migrations/20260914151000_rental_tenant_integrity/migration.sql'),
    ]);

  for (const relation of [
    ['tourProducts', 'TourProduct'],
    ['appointmentServices', 'AppointmentService'],
    ['appointmentStaff', 'AppointmentStaff'],
    ['rentalLocations', 'RentalLocation'],
    ['rentalUnitTypes', 'RentalUnitType'],
  ]) {
    assert.match(rootSchema, new RegExp(`\\b${relation[0]}\\s+${relation[1]}\\[\\]`));
  }

  const mappedRelations = [
    [tourSchema, tourMigration, 'tour_products_organization_fkey'],
    [appointmentSchema, appointmentMigration, 'appointment_services_organization_fkey'],
    [appointmentSchema, appointmentMigration, 'appointment_staff_organization_fkey'],
    [rentalSchema, rentalIntegrityMigration, 'rental_locations_organization_fkey'],
    [rentalSchema, rentalIntegrityMigration, 'rental_unit_types_organization_fkey'],
  ];

  for (const [schema, migration, constraintName] of mappedRelations) {
    assert.match(
      schema,
      new RegExp(
        `organization\\s+Organization\\s+@relation\\(fields: \\[organizationId\\], references: \\[id\\], onDelete: Restrict, onUpdate: Cascade, map: "${constraintName}"\\)`,
      ),
    );
    assert.match(migration, new RegExp(`"${constraintName}"`));
  }
});

test('payment transaction relations and provider identity indexes match checked-in database authority', async () => {
  const [paymentSchema, amendmentSchema, paymentMigration, amendmentMigration, providerLifecycleMigration, providerAttemptHistoryMigration, refundSourceMigration] = await Promise.all([
    source('prisma/payment-transactions.prisma'),
    source('prisma/hospitality-booking-commercial-amendments.prisma'),
    source('prisma/migrations/20260901063500_payment-transactions/migration.sql'),
    source('prisma/migrations/20260903083000_commercial-amendment-payment-attribution/migration.sql'),
    source('prisma/migrations/20260901103000_payment-provider-reference-lifecycle/migration.sql'),
    source('prisma/migrations/20260901124500_payment-provider-attempt-history/migration.sql'),
    source('prisma/migrations/20260903042500_refund-source-attribution/migration.sql'),
  ]);

  for (const constraintName of [
    'payment_transactions_organization_fkey',
    'payment_transactions_booking_fkey',
  ]) {
    assert.match(paymentMigration, new RegExp(`"${constraintName}"`));
    assert.match(paymentSchema, new RegExp(`map: "${constraintName}"`));
  }

  assert.match(
    paymentSchema,
    /organization\s+Organization\s+@relation\(fields: \[organizationId\], references: \[id\], onDelete: Restrict, onUpdate: Cascade, map: "payment_transactions_organization_fkey"\)/,
  );
  assert.match(
    paymentSchema,
    /booking\s+HospitalityBooking\s+@relation\(fields: \[bookingId, organizationId\], references: \[id, organizationId\], onDelete: Restrict, onUpdate: Cascade, map: "payment_transactions_booking_fkey"\)/,
  );
  assert.match(amendmentMigration, /"payment_transactions_commercial_amendment_fkey"/);
  assert.match(
    paymentSchema,
    /commercialAmendment\s+HospitalityBookingCommercialAmendment\?\s+@relation\(fields: \[commercialAmendmentId, bookingId, organizationId\], references: \[id, bookingId, organizationId\], onDelete: Restrict, onUpdate: Cascade, map: "payment_transactions_commercial_amendment_fkey"\)/,
  );
  assert.match(amendmentSchema, /paymentTransactions\s+PaymentTransaction\[\]/);

  assert.match(providerLifecycleMigration, /CREATE UNIQUE INDEX "payment_transactions_org_provider_reference_kind_key"/);
  assert.match(providerAttemptHistoryMigration, /DROP INDEX IF EXISTS "payment_transactions_org_provider_reference_kind_key"/);
  assert.doesNotMatch(paymentSchema, /payment_transactions_org_provider_reference_kind_key/);
  assert.match(
    paymentSchema,
    /@@index\(\[organizationId, providerCode, providerReference\], map: "payment_transactions_org_provider_reference_idx"\)/,
  );
  assert.match(refundSourceMigration, /CREATE INDEX "payment_transactions_org_provider_source_reference_idx"/);
  assert.match(
    paymentSchema,
    /@@index\(\[organizationId, providerCode, sourceProviderReference\], map: "payment_transactions_org_provider_source_reference_idx"\)/,
  );
});

test('public booking and checkout cross-fragment relations preserve tenant-bound migration tuples', async () => {
  const [publicSchema, checkoutSchema, paymentSchema, principalMigration, confirmationMigration, checkoutMigration] = await Promise.all([
    source('prisma/public-booking-principals.prisma'),
    source('prisma/payment-checkout-sessions.prisma'),
    source('prisma/payment-transactions.prisma'),
    source('prisma/migrations/20260902123000_public-booking-principals/migration.sql'),
    source('prisma/migrations/20260902170000_public-booking-confirmation/migration.sql'),
    source('prisma/migrations/20260902183000_checkout-session-recovery/migration.sql'),
  ]);

  const relations = [
    [publicSchema, principalMigration, 'public_booking_hold_owner_principal_fkey'],
    [publicSchema, confirmationMigration, 'public_booking_booking_owner_principal_fkey'],
    [publicSchema, principalMigration, 'public_booking_audit_principal_fkey'],
    [checkoutSchema, checkoutMigration, 'payment_checkout_sessions_principal_fkey'],
    [checkoutSchema, checkoutMigration, 'payment_checkout_sessions_payment_transaction_fkey'],
  ];

  for (const [schema, migration, constraintName] of relations) {
    assert.match(migration, new RegExp(`"${constraintName}"`));
    assert.match(schema, new RegExp(`map: "${constraintName}"`));
  }

  assert.match(publicSchema, /holdOwnerships\s+PublicBookingHoldOwnership\[\]/);
  assert.match(publicSchema, /bookingOwnerships\s+PublicBookingBookingOwnership\[\]/);
  assert.match(publicSchema, /auditEvents\s+PublicBookingAuditEvent\[\]/);
  assert.match(publicSchema, /checkoutSessions\s+PaymentCheckoutSession\[\]/);
  assert.match(paymentSchema, /checkoutSessions\s+PaymentCheckoutSession\[\]/);
  assert.match(checkoutSchema, /@@unique\(\[organizationId, paymentTransactionId\], map: "payment_checkout_sessions_org_payment_transaction_key"\)/);
});

test('commercial pricing evidence preserves migration-backed amendment attribution and database names', async () => {
  const [pricingSchema, amendmentSchema, pricingMigration, invoiceMigration, amendmentPaymentMigration] = await Promise.all([
    source('prisma/hospitality-booking-pricing-evidence.prisma'),
    source('prisma/hospitality-booking-commercial-amendments.prisma'),
    source('prisma/migrations/20260904013000_hospitality-booking-pricing-evidence/migration.sql'),
    source('prisma/migrations/20260904022000_invoice-foundation/migration.sql'),
    source('prisma/migrations/20260903083000_commercial-amendment-payment-attribution/migration.sql'),
  ]);

  assert.match(pricingMigration, /"hospitality_booking_pricing_evidence_amendment_fkey"/);
  assert.match(
    pricingSchema,
    /commercialAmendment\s+HospitalityBookingCommercialAmendment\?\s+@relation\(fields: \[commercialAmendmentId, bookingId, organizationId\], references: \[id, bookingId, organizationId\], onDelete: Restrict, onUpdate: Cascade, map: "hospitality_booking_pricing_evidence_amendment_fkey"\)/,
  );
  assert.match(amendmentSchema, /pricingEvidence\s+HospitalityBookingPricingEvidence\[\]/);
  assert.match(invoiceMigration, /"hospitality_booking_pricing_evidence_id_booking_org_key"/);
  assert.match(
    pricingSchema,
    /@@unique\(\[id, bookingId, organizationId\], map: "hospitality_booking_pricing_evidence_id_booking_org_key"\)/,
  );
  assert.match(amendmentPaymentMigration, /"hospitality_booking_commercial_amendments_id_booking_org_key"/);
  assert.match(
    amendmentSchema,
    /@@unique\(\[id, bookingId, organizationId\], map: "hospitality_booking_commercial_amendments_id_booking_org_key"\)/,
  );
});

test('invoice and adjustment-note cross-fragment relations preserve immutable evidence authority', async () => {
  const [invoiceSchema, pricingSchema, paymentSchema, amendmentSchema, invoiceMigration, issuedInvoiceMigration, adjustmentMigration, commercialAdjustmentMigration, terminalAdjustmentMigration] = await Promise.all([
    source('prisma/invoice-foundation.prisma'),
    source('prisma/hospitality-booking-pricing-evidence.prisma'),
    source('prisma/payment-transactions.prisma'),
    source('prisma/hospitality-booking-commercial-amendments.prisma'),
    source('prisma/migrations/20260904022000_invoice-foundation/migration.sql'),
    source('prisma/migrations/20260904034500_hospitality-issued-invoices/migration.sql'),
    source('prisma/migrations/20260904060000_hospitality-adjustment-notes/migration.sql'),
    source('prisma/migrations/20260904133000_commercial-amendment-adjustment-authority/migration.sql'),
    source('prisma/migrations/20260905113000_cancellation-after-amendment-authority/migration.sql'),
  ]);

  const relationAuthority = [
    [invoiceSchema, invoiceMigration, 'hospitality_invoice_preparations_pricing_evidence_fkey'],
    [invoiceSchema, invoiceMigration, 'hospitality_invoice_preparations_issuer_profile_fkey'],
    [invoiceSchema, issuedInvoiceMigration, 'hospitality_issued_invoices_preparation_fkey'],
    [invoiceSchema, issuedInvoiceMigration, 'hospitality_issued_invoices_pricing_evidence_fkey'],
    [invoiceSchema, issuedInvoiceMigration, 'hospitality_issued_invoices_issuer_profile_fkey'],
    [invoiceSchema, commercialAdjustmentMigration, 'hospitality_adj_notes_source_invoice_booking_fkey'],
    [invoiceSchema, commercialAdjustmentMigration, 'hospitality_adj_notes_refund_booking_fkey'],
    [invoiceSchema, commercialAdjustmentMigration, 'hospitality_adj_notes_commercial_amendment_fkey'],
    [invoiceSchema, commercialAdjustmentMigration, 'hospitality_adj_notes_target_pricing_fkey'],
    [invoiceSchema, terminalAdjustmentMigration, 'hospitality_adj_notes_predecessor_fkey'],
  ];

  for (const [schema, migration, constraintName] of relationAuthority) {
    assert.match(migration, new RegExp(`"${constraintName}"`));
    assert.match(schema, new RegExp(`map: "${constraintName}"`));
  }

  assert.match(adjustmentMigration, /"hospitality_issued_adjustment_notes_issued_by_fkey"/);
  assert.match(invoiceSchema, /invoicePreparations\s+HospitalityInvoicePreparation\[\]/);
  assert.match(invoiceSchema, /issuedInvoices\s+HospitalityIssuedInvoice\[\]/);
  assert.match(invoiceSchema, /adjustmentNotes\s+HospitalityIssuedAdjustmentNote\[\]/);
  assert.match(pricingSchema, /issuedAdjustmentNotes\s+HospitalityIssuedAdjustmentNote\[\]/);
  assert.match(paymentSchema, /issuedAdjustmentNotes\s+HospitalityIssuedAdjustmentNote\[\]/);
  assert.match(amendmentSchema, /issuedAdjustmentNotes\s+HospitalityIssuedAdjustmentNote\[\]/);
  assert.match(
    invoiceSchema,
    /predecessorAdjustmentNote\s+HospitalityIssuedAdjustmentNote\?\s+@relation\("HospitalityIssuedAdjustmentNotePredecessor", fields: \[predecessorAdjustmentNoteId, bookingId, organizationId, sourceInvoiceId, predecessorSourceAdjustmentOrdinal\], references: \[id, bookingId, organizationId, sourceInvoiceId, sourceAdjustmentOrdinal\], onDelete: Restrict, onUpdate: Cascade, map: "hospitality_adj_notes_predecessor_fkey"\)/,
  );
  assert.doesNotMatch(
    invoiceSchema.match(/predecessorAdjustmentNote\s+HospitalityIssuedAdjustmentNote\?[\s\S]*?\n/)?.[0] ?? '',
    /adjustmentReason/,
  );
});

test('disposable database runner regenerates the current client before migration and integration checks', async () => {
  const runner = await source('scripts/run-database-tests.mjs');
  const expectedSequence = [
    "run(npmCommand, ['run', 'prisma:validate']);",
    "run(npmCommand, ['run', 'prisma:generate']);",
    "run(npmCommand, ['run', 'db:deploy']);",
    "run(npmCommand, ['run', 'db:status']);",
    "run(npmCommand, ['run', 'db:drift']);",
    "run(process.execPath, [",
  ];

  let previousOffset = -1;
  for (const step of expectedSequence) {
    const offset = runner.indexOf(step);
    assert.ok(offset > previousOffset, `${step} must run in the expected validation order.`);
    previousOffset = offset;
  }
});

test('development documentation records multi-file drift, raw SQL, and staged migration-authority boundaries', async () => {
  const [guide, authority] = await Promise.all([
    source('docs/development-guide.md'),
    source('docs/prisma-migration-authority.md'),
  ]);

  assert.match(guide, /complete multi-file Prisma schema/i);
  assert.match(guide, /must point at the `prisma` directory rather than only `prisma\/schema\.prisma`/i);
  assert.match(guide, /Prisma-supported tenant-root foreign keys must also be represented in the multi-file schema/i);
  assert.match(guide, /Raw SQL constraints that Prisma does not model are verified by the guarded PostgreSQL integration scenarios/i);
  assert.match(guide, /regenerates the current Prisma client/i);
  assert.match(guide, /schema-first sequence/i);
  assert.match(authority, /cross-fragment relations/i);
  assert.match(authority, /additional foreign keys into root models/i);
  assert.match(authority, /Do not remove or weaken the database constraints/i);
  assert.match(authority, /not a substitute for Prisma validation/i);
  assert.match(authority, /GitHub Actions are intentionally not used/i);
});
