import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const bookingDetail = read('app/inventory/rentals/bookings/[booking-id]/page.tsx');
const staffWorkflow = read('docs/rental-booking-staff-workflow.md');
const lifecycleDocs = read('docs/rental-booking-reschedule-lifecycle.md');

test('booking detail keeps custody-extension review discoverable after pickup', () => {
  assert.match(bookingDetail, /const inCustody = booking\.fulfillment\.state === 'PICKED_UP';/);
  assert.match(bookingDetail, /const canReviewReschedule = booking\.status === 'CONFIRMED' && \(beforePickup \|\| inCustody\)/);
  assert.match(bookingDetail, /\{beforePickup \? 'Reschedule rental' : 'Extend rental'\}/);
  assert.match(bookingDetail, /Authorized staff may still review a same-unit, same-start, later-end price-neutral extension until return\./);
  assert.match(bookingDetail, /Return has been recorded\. Cancellation, further date changes, and physical-unit replacement are locked/);
});

test('booking detail no longer tells staff that all rescheduling locks immediately at pickup', () => {
  assert.doesNotMatch(bookingDetail, /Rescheduling, unit replacement, and cancellation are now locked/);
  assert.doesNotMatch(bookingDetail, /Once pickup is recorded, cancellation, rescheduling, and unit replacement fail closed/);
  assert.doesNotMatch(bookingDetail, /Cancellation, rescheduling, and physical-unit replacement are locked to preserve custody evidence/);
});

test('staff documentation matches the implemented pre-pickup reschedule and in-custody extension split', () => {
  assert.match(staffWorkflow, /labeled `Reschedule rental` before pickup and `Extend rental` while custody is active/);
  assert.match(staffWorkflow, /date-change authority narrows to the same-unit, same-start, later-end price-neutral custody extension/);
  assert.doesNotMatch(staffWorkflow, /New reschedules fail closed after pickup custody evidence exists/);
  assert.doesNotMatch(staffWorkflow, /Once pickup exists, cancellation, rescheduling, and physical-unit substitution are blocked/);
  assert.match(lifecycleDocs, /The booking detail exposes `Reschedule rental` before pickup and `Extend rental` while picked up/);
});
