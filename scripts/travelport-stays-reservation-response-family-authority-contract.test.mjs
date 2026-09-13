import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');

test('reservation response family authority is bound before downstream machine parsing', async () => {
  const wrapper = await source('src/server/suppliers/travelport-stays-reservation-trace-fetch.ts');
  const mediaTypeRead = wrapper.indexOf('const contentType = structuredJsonContentType(response.headers)');
  const mediaTypeCheck = wrapper.indexOf('if (contentType === null) invalidResponse()', mediaTypeRead);
  const bodyRead = wrapper.indexOf('rawBody = await response.text()', mediaTypeCheck);
  const traceCheck = wrapper.indexOf('if (!evidence.valid) invalidResponse()', bodyRead);
  const familyCheck = wrapper.indexOf('assertStructuredResponseFamilyForStatus(body, response.status)', traceCheck);
  const machineCheck = wrapper.indexOf('assertTravelportStaysReservationResponseMachineAuthority(body, response.status)', familyCheck);
  const rebuild = wrapper.indexOf('return rebuildStructuredResponse(', machineCheck);
  assert.ok(
    mediaTypeRead >= 0
    && mediaTypeCheck > mediaTypeRead
    && bodyRead > mediaTypeCheck
    && traceCheck > bodyRead
    && familyCheck > traceCheck
    && machineCheck > familyCheck
    && rebuild > machineCheck,
  );
  assert.match(wrapper, /mediaType !== 'application\/json'/);
  assert.match(wrapper, /charset=utf-8/);
  assert.match(wrapper, /hasReservationResponse && !isSuccessStatus/);
  assert.match(wrapper, /hasErrorResponse && !isStructuredErrorStatus/);
});

test('reservation replay exposes only reviewed structured and status-only metadata', async () => {
  const wrapper = await source('src/server/suppliers/travelport-stays-reservation-trace-fetch.ts');
  assert.match(wrapper, /function rebuildStructuredResponse/);
  assert.match(wrapper, /headers\.set\('Content-Type', contentType\)/);
  assert.match(wrapper, /headers\.set\('traceId', traceId\)/);
  assert.doesNotMatch(wrapper, /headers: new Headers\(response\.headers\)/);
  assert.match(wrapper, /function boundedRetryAfterHeader/);
  assert.match(wrapper, /\/\^\\d\+\$\//);
  assert.match(wrapper, /new Date\(parsed\)\.toUTCString\(\) !== value/);
});

test('reservation machine authority rejects nested evidence that conflicts with the response family and HTTP status', async () => {
  const guard = await source('src/server/suppliers/travelport-stays-reservation-response-authority.ts');
  assert.ok(guard.includes("responseFamily === 'ReservationResponse' && result.Error !== undefined"));
  assert.ok(guard.includes("responseFamily === 'ErrorResponse'"));
  assert.ok(guard.includes("responseFamily === 'ErrorResponse' && (hasWarning || hasWarnings)"));
  assert.ok(guard.includes("responseFamily === 'ErrorResponse' && response.Reservation !== undefined"));
  assert.ok(guard.includes('httpStatus !== undefined && statusCode !== httpStatus'));
});
