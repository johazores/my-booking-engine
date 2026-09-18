import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const domain = readFileSync('src/server/bookings/rental-booking-cancellation-domain.ts', 'utf8');
const service = readFileSync('src/server/bookings/rental-booking-cancellation-service.ts', 'utf8');
const migration = readFileSync('prisma/migrations/20260918044500_rental_booking_cancellation_audit_uniqueness/migration.sql', 'utf8');
const docs = readFileSync('docs/rental-booking-cancellation-replay-integrity.md', 'utf8');

test('rental cancellation replay classifies retained terminal evidence before returning idempotent success', () => {
  assert.match(domain, /classifyRentalBookingCancellationReplayEvidence/);
  assert.match(domain, /\| 'REASON_MISMATCH'/);
  assert.match(domain, /\| 'EVIDENCE_MISMATCH'/);
  assert.match(domain, /candidate\.status !== 'CANCELLED'/);
  assert.match(domain, /candidate\.inventoryProtectionReleased !== true/);
  assert.match(domain, /normalizeRentalBookingCancellationReason\(candidate\.cancellationReason\)/);
  assert.match(domain, /evidence\.cancelledAt !== input\.cancelledAt/);
  assert.match(domain, /evidence\.allocationId !== input\.allocationId/);
  assert.match(domain, /evidence\.cancellationReason !== input\.cancellationReason/);
});

test('cancelled replay requires one tenant-owned cancellation audit and exact retained lifecycle evidence', () => {
  assert.match(service, /booking\.status === 'CANCELLED'/);
  assert.match(service, /transaction\.auditEvent\.findMany/);
  assert.match(service, /organizationId: input\.organizationId/);
  assert.match(service, /action: 'booking\.rental\.cancelled'/);
  assert.match(service, /resourceType: 'rental-booking'/);
  assert.match(service, /resourceId: booking\.id/);
  assert.match(service, /take: 2/);
  assert.match(service, /cancellationAudits\.length !== 1/);
  assert.match(service, /classifyRentalBookingCancellationReplayEvidence/);
  assert.match(service, /cancelledAt: booking\.cancelledAt\.toISOString\(\)/);
  assert.match(service, /allocationId: booking\.allocation\.id/);
  assert.match(service, /replayDisposition === 'EVIDENCE_MISMATCH'/);
  assert.match(service, /replayDisposition === 'REASON_MISMATCH'/);
  assert.match(service, /already cancelled with different retained cancellation reason evidence/);

  const cancelledBranchStart = service.indexOf("if (booking.status === 'CANCELLED')");
  const idempotentReturn = service.indexOf('idempotent: true', cancelledBranchStart);
  const auditRead = service.indexOf('transaction.auditEvent.findMany', cancelledBranchStart);
  const replayClassification = service.indexOf('classifyRentalBookingCancellationReplayEvidence', auditRead);
  assert.ok(cancelledBranchStart >= 0 && auditRead > cancelledBranchStart);
  assert.ok(replayClassification > auditRead);
  assert.ok(idempotentReturn > replayClassification, 'idempotent success must follow retained-evidence verification');
});

test('database and documentation retain one cancellation audit as replay authority', () => {
  assert.match(migration, /FROM "audit_events"/);
  assert.match(migration, /"action" = 'booking\.rental\.cancelled'/);
  assert.match(migration, /"resourceType" = 'rental-booking'/);
  assert.match(migration, /HAVING COUNT\(\*\) > 1/);
  assert.match(migration, /CREATE UNIQUE INDEX "audit_events_rental_booking_cancellation_once_idx"/);
  assert.match(migration, /"organizationId", "resourceId", "action", "resourceType"/);
  assert.match(docs, /idempotent success requires the normalized request reason to exactly match/i);
  assert.match(docs, /requires exactly one matching event/i);
  assert.match(docs, /does not introduce cancellation fees, automatic refunds, provider calls/i);
});
