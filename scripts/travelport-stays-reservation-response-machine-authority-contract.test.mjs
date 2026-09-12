import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');

test('trace-bound reservation transport validates machine authority before rebuilding provider bodies', async () => {
  const wrapper = await source('src/server/suppliers/travelport-stays-reservation-trace-fetch.ts');
  assert.match(wrapper, /assertTravelportStaysReservationResponseMachineAuthority/);
  const traceCheck = wrapper.indexOf('if (!evidence.valid) invalidResponse()');
  const authorityCheck = wrapper.indexOf('assertTravelportStaysReservationResponseMachineAuthority(body)', traceCheck);
  const rebuild = wrapper.indexOf('return rebuildResponse(response, rawBody)', authorityCheck);
  assert.ok(traceCheck >= 0 && authorityCheck > traceCheck && rebuild > authorityCheck);
});

test('reservation response guard rejects normalization-confusable commercial machine evidence', async () => {
  const guard = await source('src/server/suppliers/travelport-stays-reservation-response-authority.ts');
  assert.match(guard, /ASCII_CONTROL_PATTERN = \/\[\\u0000-\\u001f\\u007f\]\//);
  assert.match(guard, /value\.trim\(\) !== value/);
  assert.match(guard, /\^\[A-Z_\]\{2,32\}\$/);
  assert.match(guard, /\^\\d\{1,8\}\$/);
  assert.match(guard, /MAX_OFFERS = 32/);
  assert.match(guard, /MAX_PRODUCTS_PER_OFFER = 8/);
  assert.match(guard, /MAX_RECEIPTS = 32/);
  assert.match(guard, /MAX_RESULT_ITEMS = 32/);
  assert.match(guard, /validateReservation\(response\)/);
  assert.match(guard, /assertBoundedProviderTextIfPresent\(warning\.Message/);
  assert.ok(guard.includes("result.Errors !== undefined"));
  assert.ok(guard.includes("resultType !== 'Result'"));
  assert.ok(guard.includes("error['@type'] !== 'ErrorDetail'"));
  assert.ok(guard.includes('error.Category !== undefined'));
  assert.ok(guard.includes('error.SourceID === undefined'));
  assert.ok(guard.includes('error.SourceCode === undefined'));
  assert.ok(guard.includes('error.category === undefined'));
  assert.ok(guard.includes('error.Message === undefined'));
  assert.ok(guard.includes('MIN_ERROR_STATUS_CODE = 100'));
  assert.ok(guard.includes('MAX_ERROR_STATUS_CODE = 599'));
  assert.ok(guard.includes('MAX_WARNING_STATUS_CODE = 999'));
  assert.ok(guard.includes('errorValues.length > 0 && (hasWarning || hasWarnings)'));
  assert.ok(guard.includes("warningType !== 'Warning'"));
  assert.ok(guard.includes('warning.Message === undefined || warning.Message === null'));
  assert.ok(guard.includes("Object.prototype.hasOwnProperty.call(response, 'traceID')"));
});

test('production integration keeps all reservation executors behind the trace and machine-authority wrapper', async () => {
  const integration = await source('src/server/integrations/travelport-stays-integration.ts');
  assert.match(
    integration,
    /createTravelportStaysReservationTraceAuthorityFetch\(\s*createTravelportStaysTraceFetch\(/,
  );
  for (const boundary of [
    'reservationCreateExecutor',
    'reservationRecoveryProvider',
    'reservationSyncExecutor',
  ]) assert.match(integration, new RegExp(`${boundary}: new TravelportStays`));
});
