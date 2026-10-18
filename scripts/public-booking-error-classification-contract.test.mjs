import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routeDirectory = '../app/api/public-bookings/[organization-slug]/hospitality/';
const cases = [
  { route: 'holds/route.ts', validators: ['AvailabilityValidationError', 'PublicBookingRequestValidationError', 'PublicBookingHoldQuantityValidationError'] },
  { route: 'quote/route.ts', validators: ['PricingValidationError'] },
  { route: 'confirmation/route.ts', validators: [
    'BookingDomainValidationError', 'CustomerValidationError', 'PricingValidationError', 'PublicBookingRequestValidationError',
  ] },
];

function readRoute(route) {
  return readFileSync(new URL(`${routeDirectory}${route}`, import.meta.url), 'utf8');
}

function loadErrorHandler(source) {
  const start = source.indexOf('function errorResponse(error: unknown) {');
  const end = source.indexOf('\n}\n', start);
  assert.ok(start >= 0 && end > start, 'Expected the public HTTP error boundary');
  const body = source.slice(start, end + 2).replace('error: unknown', 'error');
  const classNames = [...new Set([...body.matchAll(/error instanceof ([A-Za-z][A-Za-z0-9]*)/g)].map((match) => match[1]))];
  const classes = Object.fromEntries(classNames.map((name) => [name, class extends Error {}]));
  const response = { json: (payload, options) => ({ payload, status: options.status }) };
  const handler = new Function(...classNames, 'Response', 'noStoreHeaders', `${body}\nreturn errorResponse;`)(
    ...classNames.map((name) => classes[name]), response, { 'cache-control': 'no-store' },
  );
  return { handler, classes };
}

for (const { route, validators } of cases) {
  test(`${route} only treats known domain validation failures as customer errors`, () => {
    const source = readRoute(route);
    assert.doesNotMatch(source, /error instanceof Error &&/);
    const { handler, classes } = loadErrorHandler(source);
    for (const name of validators) {
      assert.ok(classes[name], `Expected explicit ${name} classification`);
      const result = handler(new classes[name]('Invalid booking input.'));
      assert.equal(result.status, 400);
      assert.equal(result.payload.error, 'validation');
    }
    const config = handler(new classes.PublicBookingCapabilityConfigurationError('Deployment secret is required.'));
    assert.equal(config.status, 503);
    assert.doesNotMatch(JSON.stringify(config.payload), /secret|required/i);

    const unexpected = handler(new Error('DATABASE_URL is required; internal connection is invalid.'));
    assert.equal(unexpected.status, 500);
    assert.deepEqual(unexpected.payload, { error: 'internal-error' });
    const forged = handler({ name: validators[0], message: 'invalid' });
    assert.equal(forged.status, 500);
  });
}

test('public routes reject malformed nested booking payload shapes before service calls', () => {
  const holds = readRoute('holds/route.ts');
  const quote = readRoute('quote/route.ts');
  const confirmation = readRoute('confirmation/route.ts');
  assert.match(holds, /requestDetails\.quantity/);
  assert.match(holds, /requestDetails\[field\]/);
  assert.match(quote, /input\.addonSelections\.every/);
  assert.match(confirmation, /input\.guests\.every/);
  assert.match(confirmation, /input\.addonSelections\.every/);
  assert.match(confirmation, /typeof customer\.email !== 'string'/);
});
