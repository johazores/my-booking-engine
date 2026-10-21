import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routes = [
  'app/api/inventory/rentals/bookings/[booking-id]/payments/manual/route.ts',
  'app/api/inventory/rentals/bookings/[booking-id]/payments/refunds/route.ts',
];

function assertBookingPriceRoute(source, path) {
  assert.ok(source.includes("import { isRentalFinancialInputValidationError } from '@/server/payments/rental-financial-input-validation.ts';"), path);
  assert.ok(source.includes("if (isRentalFinancialInputValidationError(error)) return 'payment-validation';"), path);
  assert.doesNotMatch(source, /\.test\(error\.message\)/, path);
  assert.doesNotMatch(source, /message:\s*error\.message/, path);
  assert.doesNotMatch(source, /return\s+error\.message/, path);
  assert.ok(source.includes('OrganizationPermissionDeniedError'), path);
  assert.ok(source.includes('RentalPaymentConflictError'), path);
  assert.ok(source.includes('RentalPaymentUnavailableError'), path);
  assert.ok(source.includes("code === 'payment-server' ? 'failed' : 'rejected'"), path);
  assert.ok(source.includes('organizationId: organization.id'), path);
  assert.ok(source.includes('actorUserId: session.user.id'), path);
  assert.ok(source.includes('encodeURIComponent(bookingId)'), path);
  assert.ok(
    source.indexOf("const mutation = await prepareInventoryMutationRequest(")
      < source.indexOf('const formData = await readInventoryFormData(request)'),
    path,
  );
  assert.ok(source.includes("const amount = formField(formData, 'amount');"), path);
  assert.ok(source.includes('      amount,'), path);
}

test('booking-price manual payment and refund routes classify only typed input failures', () => {
  for (const path of routes) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    assertBookingPriceRoute(source, path);
  }
});

test('booking-price amount parsers throw typed input errors', () => {
  const service = readFileSync(new URL('../src/server/payments/rental-payment-service.ts', import.meta.url), 'utf8');
  assert.ok(service.includes("import { assertPaymentProviderCapability, PaymentInputValidationError } from './payment-provider.ts';"));
  for (const operation of ['payment', 'refund']) {
    for (const reason of ['a valid money value', 'greater than zero']) {
      const message = `Rental ${operation} amount must be ${reason}.`;
      assert.ok(service.includes(`throw new PaymentInputValidationError('${message}');`), message);
      assert.ok(!service.includes(`throw new Error('${message}');`), message);
    }
  }
  assert.ok(service.includes('parseMoneyMajorToMinor(normalized, currency)'));
});

test('contract rejects message-based error classification and raw diagnostic exposure', () => {
  const valid = readFileSync(new URL(`../${routes[0]}`, import.meta.url), 'utf8');
  assert.throws(
    () => assertBookingPriceRoute(valid.replace(
      "if (isRentalFinancialInputValidationError(error)) return 'payment-validation';",
      "if (error instanceof Error && /invalid/i.test(error.message)) return 'payment-validation';",
    ), routes[0]),
    assert.AssertionError,
  );
  assert.throws(
    () => assertBookingPriceRoute(valid.replace('return \'payment-server\';', "return error.message;"), routes[0]),
    assert.AssertionError,
  );
});
