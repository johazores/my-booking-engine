import assert from 'node:assert/strict';
import test from 'node:test';

import { BookingDomainValidationError } from './booking-domain.ts';
import { AvailabilityValidationError } from '../availability/availability-domain.ts';
import { TenantIdentifierValidationError } from '../tenancy/tenant-scope.ts';
import { PaymentInputValidationError } from '../payments/payment-provider.ts';
import {
  BookingApiPayloadError,
  HOSPITALITY_BOOKING_REQUEST_MAX_BYTES,
  hospitalityBookingApiError,
  readHospitalityBookingJsonObject,
} from './hospitality-booking-http.ts';

function jsonRequest(body: BodyInit, headers?: Record<string, string>) {
  return new Request('https://booking.example.com/api/bookings/hospitality/holds', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
    body,
  });
}

async function rejectsPayload(request: Request, maxBytes?: number) {
  await assert.rejects(
    () => readHospitalityBookingJsonObject(request, maxBytes),
    (error: unknown) => error instanceof BookingApiPayloadError,
  );
}

test('reads only JSON object bodies', async () => {
  assert.deepEqual(await readHospitalityBookingJsonObject(jsonRequest('{"value":1}')), { value: 1 });
  await rejectsPayload(jsonRequest('null'));
  await rejectsPayload(jsonRequest('[]'));
  await rejectsPayload(jsonRequest('{'));
  await rejectsPayload(new Request('https://booking.example.com/api', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: '{}',
  }));
  await rejectsPayload(new Request('https://booking.example.com/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  }));
});

test('rejects invalid and oversized advertised content lengths', async () => {
  await rejectsPayload(jsonRequest('{}', { 'content-length': 'nope' }));
  await rejectsPayload(jsonRequest('{}', {
    'content-length': String(HOSPITALITY_BOOKING_REQUEST_MAX_BYTES + 1),
  }));
});

test('rejects streamed bodies above the authenticated booking ceiling', async () => {
  const body = JSON.stringify({ value: 'x'.repeat(HOSPITALITY_BOOKING_REQUEST_MAX_BYTES) });
  assert.ok(Buffer.byteLength(body, 'utf8') > HOSPITALITY_BOOKING_REQUEST_MAX_BYTES);
  await rejectsPayload(jsonRequest(body));
});

test('rejects invalid UTF-8 before JSON parsing', async () => {
  const invalidUtf8 = new Uint8Array([123, 34, 118, 97, 108, 117, 101, 34, 58, 34, 255, 34, 125]);
  await rejectsPayload(jsonRequest(invalidUtf8));
});

test('supports a smaller caller-specific byte ceiling', async () => {
  assert.deepEqual(await readHospitalityBookingJsonObject(jsonRequest('{"value":1}'), 32), { value: 1 });
  await rejectsPayload(jsonRequest('{"value":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}'), 32);
  await rejectsPayload(jsonRequest('{}'), 0);
});

test('normalizes bounded payload failures without exposing parser detail', async () => {
  const response = hospitalityBookingApiError(new BookingApiPayloadError());
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { error: 'invalid-request' });
});

test('authenticated booking HTTP only exposes explicitly classified customer validation', async () => {
  for (const message of [
    'DATABASE_URL is required to initialize the database client.',
    'Provider authorization is invalid: internal token is required.',
    'Internal payment state cannot be reconciled.',
  ]) {
    const response = hospitalityBookingApiError(new Error(message));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'internal-error' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  for (const thrown of [null, { message: 'Database password is invalid and must be rotated.' }]) {
    const response = hospitalityBookingApiError(thrown);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'internal-error' });
  }
  const bookingValidation = hospitalityBookingApiError(new BookingDomainValidationError('Guest first name is required.'));
  assert.equal(bookingValidation.status, 400);
  assert.deepEqual(await bookingValidation.json(), { error: 'validation', message: 'Guest first name is required.' });
  const availabilityValidation = hospitalityBookingApiError(new AvailabilityValidationError('Arrival date must use YYYY-MM-DD.'));
  assert.equal(availabilityValidation.status, 400);
  assert.deepEqual(await availabilityValidation.json(), { error: 'validation', message: 'Arrival date must use YYYY-MM-DD.' });
  const paymentInput = hospitalityBookingApiError(new PaymentInputValidationError('Payment idempotency key is required.'));
  assert.equal(paymentInput.status, 400);
  assert.deepEqual(await paymentInput.json(), { error: 'validation', message: 'Payment idempotency key is required.' });
  const manualReference = hospitalityBookingApiError(new PaymentInputValidationError('Manual payment reference is required.'));
  assert.equal(manualReference.status, 400);
  assert.deepEqual(await manualReference.json(), { error: 'validation', message: 'Manual payment reference is required.' });
  const invalidFingerprint = hospitalityBookingApiError(new BookingDomainValidationError('adjustmentFingerprint must be a SHA-256 fingerprint.'));
  assert.equal(invalidFingerprint.status, 400);
  assert.deepEqual(await invalidFingerprint.json(), { error: 'validation', message: 'adjustmentFingerprint must be a SHA-256 fingerprint.' });
  const invalidId = hospitalityBookingApiError(new TenantIdentifierValidationError('bookingId must be a valid UUID.'));
  assert.equal(invalidId.status, 400);
  assert.deepEqual(await invalidId.json(), { error: 'validation', message: 'bookingId must be a valid UUID.' });
});
