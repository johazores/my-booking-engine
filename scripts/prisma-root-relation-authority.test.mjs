import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repositoryRoot = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, repositoryRoot), 'utf8');
}

function assertMappedConstraint(schema, migration, constraintName) {
  assert.match(migration, new RegExp(`"${constraintName}"`));
  assert.match(schema, new RegExp(`map: "${constraintName}"`));
}

test('public booking and checkout roots preserve migration-backed tenant ownership', async () => {
  const [root, publicBooking, checkout, principalMigration, confirmationMigration, checkoutMigration] = await Promise.all([
    source('prisma/schema.prisma'),
    source('prisma/public-booking-principals.prisma'),
    source('prisma/payment-checkout-sessions.prisma'),
    source('prisma/migrations/20260902123000_public-booking-principals/migration.sql'),
    source('prisma/migrations/20260902170000_public-booking-confirmation/migration.sql'),
    source('prisma/migrations/20260902183000_checkout-session-recovery/migration.sql'),
  ]);

  for (const [schema, migration, constraintName] of [
    [publicBooking, principalMigration, 'public_booking_principals_organization_fkey'],
    [publicBooking, principalMigration, 'public_booking_hold_owner_hold_fkey'],
    [publicBooking, confirmationMigration, 'public_booking_booking_owner_booking_fkey'],
    [checkout, checkoutMigration, 'payment_checkout_sessions_organization_fkey'],
    [checkout, checkoutMigration, 'payment_checkout_sessions_booking_fkey'],
  ]) {
    assertMappedConstraint(schema, migration, constraintName);
  }

  assert.match(root, /publicBookingPrincipals\s+PublicBookingPrincipal\[\]/);
  assert.match(root, /paymentCheckoutSessions\s+PaymentCheckoutSession\[\]/);
  assert.match(root, /publicBookingOwnership\s+PublicBookingHoldOwnership\?/);
  assert.match(root, /publicBookingOwnership\s+PublicBookingBookingOwnership\?/);
  assert.match(root, /checkoutSessions\s+PaymentCheckoutSession\[\]/);
  assert.match(
    publicBooking,
    /hold\s+HospitalityAvailabilityHold\s+@relation\(fields: \[holdId, organizationId\], references: \[id, organizationId\], onDelete: Restrict, onUpdate: Cascade, map: "public_booking_hold_owner_hold_fkey"\)/,
  );
  assert.match(
    publicBooking,
    /booking\s+HospitalityBooking\s+@relation\(fields: \[bookingId, organizationId\], references: \[id, organizationId\], onDelete: Restrict, onUpdate: Cascade, map: "public_booking_booking_owner_booking_fkey"\)/,
  );
});

test('commercial amendment and pricing roots preserve tenant-bound migration tuples and role names', async () => {
  const [
    root,
    amendment,
    pricing,
    amendmentMigration,
    amendmentPortabilityMigration,
    pricingMigration,
  ] = await Promise.all([
    source('prisma/schema.prisma'),
    source('prisma/hospitality-booking-commercial-amendments.prisma'),
    source('prisma/hospitality-booking-pricing-evidence.prisma'),
    source('prisma/migrations/20260903013000_commercial-booking-amendments/migration.sql'),
    source('prisma/migrations/20260922081500-hospitality-commercial-amendment-identifier-portability/migration.sql'),
    source('prisma/migrations/20260904013000_hospitality-booking-pricing-evidence/migration.sql'),
  ]);

  for (const constraintName of [
    'hospitality_booking_commercial_amendments_organization_fkey',
    'hospitality_booking_commercial_amendments_booking_fkey',
    'hospitality_booking_commercial_amendments_property_fkey',
    'hospitality_booking_commercial_amendments_target_room_type_fkey',
    'hospitality_booking_commercial_amendments_target_rate_plan_fkey',
    'hospitality_booking_commercial_amendments_target_hold_fkey',
  ]) {
    assertMappedConstraint(amendment, amendmentMigration, constraintName);
  }

  for (const constraintName of [
    'hospitality_commercial_amendments_current_room_type_fkey',
    'hospitality_commercial_amendments_current_rate_plan_fkey',
  ]) {
    assertMappedConstraint(amendment, amendmentPortabilityMigration, constraintName);
  }

  for (const constraintName of [
    'hospitality_booking_pricing_evidence_organization_fkey',
    'hospitality_booking_pricing_evidence_booking_fkey',
    'hospitality_booking_pricing_evidence_property_fkey',
    'hospitality_booking_pricing_evidence_room_type_fkey',
    'hospitality_booking_pricing_evidence_rate_plan_fkey',
  ]) {
    assertMappedConstraint(pricing, pricingMigration, constraintName);
  }

  for (const inverse of [
    /hospitalityCommercialAmendments\s+HospitalityBookingCommercialAmendment\[\]/,
    /hospitalityBookingPricingEvidence\s+HospitalityBookingPricingEvidence\[\]/,
    /commercialAmendments\s+HospitalityBookingCommercialAmendment\[\]/,
    /pricingEvidence\s+HospitalityBookingPricingEvidence\[\]/,
    /bookingPricingEvidence\s+HospitalityBookingPricingEvidence\[\]/,
  ]) {
    assert.match(root, inverse);
  }

  assert.match(root, /commercialAmendmentTarget\s+HospitalityBookingCommercialAmendment\?/);
  assert.doesNotMatch(root, /commercialAmendmentTarget\s+HospitalityBookingCommercialAmendment\[\]/);
  assert.match(root, /currentCommercialAmendments\s+HospitalityBookingCommercialAmendment\[\]\s+@relation\("HospitalityCommercialAmendmentCurrentRoomType"\)/);
  assert.match(root, /targetCommercialAmendments\s+HospitalityBookingCommercialAmendment\[\]\s+@relation\("HospitalityCommercialAmendmentTargetRoomType"\)/);
  assert.match(root, /currentCommercialAmendments\s+HospitalityBookingCommercialAmendment\[\]\s+@relation\("HospitalityCommercialAmendmentCurrentRatePlan"\)/);
  assert.match(root, /targetCommercialAmendments\s+HospitalityBookingCommercialAmendment\[\]\s+@relation\("HospitalityCommercialAmendmentTargetRatePlan"\)/);
  assert.match(amendmentMigration, /CREATE UNIQUE INDEX "hospitality_booking_commercial_amendments_org_target_hold_key"/);
  assert.match(
    amendmentPortabilityMigration,
    /ALTER INDEX "hospitality_booking_commercial_amendments_org_booking_status_ex"\s+RENAME TO "hospitality_commercial_amendments_booking_status_expiry_idx"/,
  );
});

test('invoice roots preserve organization booking and user foreign-key authority', async () => {
  const [root, invoice, foundationMigration, issuedMigration, adjustmentMigration] = await Promise.all([
    source('prisma/schema.prisma'),
    source('prisma/invoice-foundation.prisma'),
    source('prisma/migrations/20260904022000_invoice-foundation/migration.sql'),
    source('prisma/migrations/20260904034500_hospitality-issued-invoices/migration.sql'),
    source('prisma/migrations/20260904060000_hospitality-adjustment-notes/migration.sql'),
  ]);

  for (const constraintName of [
    'invoice_issuer_profiles_organization_fkey',
    'invoice_issuer_profiles_created_by_fkey',
    'hospitality_invoice_preparations_organization_fkey',
    'hospitality_invoice_preparations_booking_fkey',
    'hospitality_invoice_preparations_created_by_fkey',
  ]) {
    assertMappedConstraint(invoice, foundationMigration, constraintName);
  }

  for (const constraintName of [
    'hospitality_invoice_number_sequences_organization_fkey',
    'hospitality_issued_invoices_organization_fkey',
    'hospitality_issued_invoices_booking_fkey',
    'hospitality_issued_invoices_issued_by_fkey',
  ]) {
    assertMappedConstraint(invoice, issuedMigration, constraintName);
  }

  for (const constraintName of [
    'hospitality_issued_adjustment_notes_organization_fkey',
    'hospitality_issued_adjustment_notes_booking_fkey',
    'hospitality_issued_adjustment_notes_issued_by_fkey',
  ]) {
    assertMappedConstraint(invoice, adjustmentMigration, constraintName);
  }

  for (const inverse of [
    /invoiceIssuerProfiles\s+InvoiceIssuerProfile\[\]/,
    /hospitalityInvoicePreparations\s+HospitalityInvoicePreparation\[\]/,
    /hospitalityInvoiceNumberSequences\s+HospitalityInvoiceNumberSequence\[\]/,
    /hospitalityIssuedInvoices\s+HospitalityIssuedInvoice\[\]/,
    /hospitalityIssuedAdjustmentNotes\s+HospitalityIssuedAdjustmentNote\[\]/,
    /createdInvoiceIssuerProfiles\s+InvoiceIssuerProfile\[\]/,
    /createdHospitalityInvoicePreparations\s+HospitalityInvoicePreparation\[\]/,
    /issuedHospitalityInvoices\s+HospitalityIssuedInvoice\[\]/,
    /issuedHospitalityAdjustmentNotes\s+HospitalityIssuedAdjustmentNote\[\]/,
    /invoicePreparations\s+HospitalityInvoicePreparation\[\]/,
    /issuedInvoices\s+HospitalityIssuedInvoice\[\]/,
    /issuedAdjustmentNotes\s+HospitalityIssuedAdjustmentNote\[\]/,
  ]) {
    assert.match(root, inverse);
  }
});

test('Prisma authority documentation distinguishes source parity from live drift proof', async () => {
  const authority = await source('docs/prisma-migration-authority.md');

  assert.match(authority, /root-side Prisma models now expose the inverse relations/i);
  assert.match(authority, /not a declaration that the entire migration history is drift-clean/i);
  assert.match(authority, /raw PostgreSQL checks\/exclusion constraints remain database-only authority/i);
  assert.match(authority, /prisma-root-relation-authority\.test\.mjs/);
  assert.match(authority, /passing source contract must never be reported as a passing Prisma drift or live database check/i);
  assert.match(authority, /GitHub Actions are intentionally not used/i);
});
