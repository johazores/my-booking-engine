import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const bookings = read('src/server/bookings/hospitality-booking-service.ts');
const audits = read('src/server/bookings/hospitality-booking-audit-service.ts');
const payments = read('src/server/payments/payment-service.ts');
const docs = read('docs/hospitality-booking-read-consistency.md');

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing source section: ${start}`);
  const endIndex = end ? source.indexOf(end, startIndex + start.length) : source.length;
  assert.notEqual(endIndex, -1, `Missing source section terminator: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('booking detail reads booking and ordered guests from one repeatable-read snapshot', () => {
  const source = section(bookings, 'export async function getHospitalityBooking', 'export async function listHospitalityBookings');
  assert.match(source, /db\.\$transaction\(async \(transaction\) =>/);
  assert.match(source, /transaction\.hospitalityBooking\.findFirst/);
  assert.match(source, /where: \{ id: input\.bookingId, organizationId: input\.organizationId \}/);
  assert.match(source, /readBookingGuests\(transaction, input\.organizationId, booking\.id\)/);
  assert.match(source, /isolationLevel: 'RepeatableRead'/);
});

test('booking collection count page and page guests share one repeatable-read snapshot', () => {
  const source = section(bookings, 'export async function listHospitalityBookings');
  assert.match(source, /transaction\.hospitalityBooking\.count\(\{ where \}\)/);
  assert.match(source, /transaction\.hospitalityBooking\.findMany/);
  assert.match(source, /transaction\.hospitalityBookingGuest\.findMany/);
  assert.match(source, /where: \{ organizationId: input\.organizationId, bookingId: \{ in: bookings\.map/);
  assert.match(source, /orderBy: \[\{ createdAt: 'desc' \}, \{ id: 'asc' \}\]/);
  assert.match(source, /orderBy: \[\{ bookingId: 'asc' \}, \{ position: 'asc' \}\]/);
  assert.match(source, /isolationLevel: 'RepeatableRead'/);
  assert.doesNotMatch(source, /await db\.hospitalityBooking\.(?:count|findMany)/);
});

test('booking audit authorization target count and rows share one repeatable-read snapshot', () => {
  const source = section(audits, 'export async function listHospitalityBookingAuditEvents');
  assert.match(source, /permission: 'booking:read'/);
  assert.match(source, /transaction\.hospitalityBooking\.findFirst/);
  assert.match(source, /transaction\.auditEvent\.count/);
  assert.match(source, /transaction\.auditEvent\.findMany/);
  assert.match(source, /organizationId: input\.organizationId, resourceType: 'hospitality-booking', resourceId: booking\.id/);
  assert.match(source, /orderBy: \[\{ createdAt: 'desc' \}, \{ id: 'desc' \}\]/);
  assert.match(source, /isolationLevel: 'RepeatableRead'/);
});

test('payment booking summary count and page share one repeatable-read snapshot', () => {
  const source = section(payments, 'export async function listBookingPaymentTransactions');
  assert.match(source, /permission: 'payment:read'/);
  assert.match(source, /transaction\.hospitalityBooking\.findFirst/);
  assert.match(source, /transaction\.paymentTransaction\.count/);
  assert.match(source, /transaction\.paymentTransaction\.findMany/);
  assert.match(source, /const where = \{ organizationId: input\.organizationId, bookingId: input\.bookingId \}/);
  assert.match(source, /orderBy: \[\{ createdAt: 'desc' \}, \{ id: 'asc' \}\]/);
  assert.match(source, /isolationLevel: 'RepeatableRead'/);
  assert.doesNotMatch(source, /await db\.paymentTransaction\.(?:count|findMany)/);
});

test('documentation keeps snapshot pagination separate from complete commercial evidence', () => {
  assert.match(docs, /RepeatableRead/);
  assert.match(docs, /booking and its ordered guest snapshots/i);
  assert.match(docs, /payment transaction count\/page/i);
  assert.match(docs, /audit count\/page/i);
  assert.match(docs, /Bounded pagination is not complete commercial evidence/);
  assert.match(docs, /serializable\/advisory-lock\/idempotency boundaries/);
});
