import assert from 'node:assert/strict';
import test from 'node:test';

import {
  derivePublicBookingCheckoutIdempotencyKey,
  derivePublicBookingConfirmationIdempotencyKey,
  derivePublicBookingHoldIdempotencyKey,
} from './public-booking-request-domain.ts';

const secret = '0123456789abcdef0123456789abcdef';
const organizationId = '11111111-1111-4111-8111-111111111111';
const requestKey = '22222222-2222-4222-8222-222222222222';

test('public checkout idempotency is deterministic and isolated from hold and confirmation scopes', () => {
  const checkout = derivePublicBookingCheckoutIdempotencyKey({ secret, organizationId, requestKey });
  assert.equal(checkout, derivePublicBookingCheckoutIdempotencyKey({ secret, organizationId, requestKey }));
  assert.match(checkout, /^public:[0-9a-f]{64}$/);
  assert.notEqual(checkout, derivePublicBookingHoldIdempotencyKey({ secret, organizationId, requestKey }));
  assert.notEqual(checkout, derivePublicBookingConfirmationIdempotencyKey({ secret, organizationId, requestKey }));
});

test('public checkout idempotency is tenant bound', () => {
  const first = derivePublicBookingCheckoutIdempotencyKey({ secret, organizationId, requestKey });
  const second = derivePublicBookingCheckoutIdempotencyKey({
    secret,
    organizationId: '33333333-3333-4333-8333-333333333333',
    requestKey,
  });
  assert.notEqual(first, second);
});
