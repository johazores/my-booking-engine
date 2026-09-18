import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync('app/inventory/rentals/bookings/[booking-id]/page.tsx', 'utf8');
const action = readFileSync('src/components/rental-booking-cancel-action.tsx', 'utf8');
const cancellationDocs = readFileSync('docs/rental-booking-cancellation.md', 'utf8');

test('staff cancellation stays discoverable without leaking payment amounts and submits only after zero effective settlement review', () => {
  assert.match(page, /const canReviewCancellation = booking\.status === 'CONFIRMED' && beforePickup && Boolean\(booking\.allocation\) && canManageBooking && canManageAvailability;/);
  assert.match(page, /canReviewCancellation \? <section/);
  assert.match(page, /settlement=\{paymentData\?\.settlement \?\? null\}/);
  assert.doesNotMatch(page, /const canCancel = .*paymentClearedForCancellation/);
  assert.doesNotMatch(page, /full accepted booking amount/);
  assert.match(page, /payment amount or reference was invalid/);

  assert.match(action, /readRentalBookingEffectiveSettlement/);
  assert.match(action, /Settlement verification required/);
  assert.match(action, /No payment amount is exposed without payment-read permission/);
  assert.match(action, /Payment reconciliation required/);
  assert.match(action, /Refund effective rental settlement first/);
  assert.match(action, /settlement\.currentNetSettledMinor > 0n/);
  assert.match(action, /settlement\.fullyRefunded/);
  assert.match(action, /Effective rental settlement is reconciled to zero/);
  assert.match(action, /applied commercial amendment/i);
  assert.match(action, /does not collect, refund, or change money/i);
  assert.match(action, /Confirm cancellation/);
  assert.match(action, /method="post"/);
  assert.doesNotMatch(action, /payment and deposit workflows are not implemented/i);
});

test('cancellation documentation describes the effective settlement gate without inventing automatic refunds', () => {
  assert.match(cancellationDocs, /section remains visible/i);
  assert.match(cancellationDocs, /payment:read/i);
  assert.match(cancellationDocs, /effective settlement/i);
  assert.match(cancellationDocs, /exact zero/i);
  assert.match(cancellationDocs, /does not automatically refund/i);
  assert.match(cancellationDocs, /security-bond disposition/i);
});
