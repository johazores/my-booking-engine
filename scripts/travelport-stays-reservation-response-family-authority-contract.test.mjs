import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');

test('reservation response family authority is bound before downstream machine parsing and replay', async () => {
  const wrapper = await source('src/server/suppliers/travelport-stays-reservation-trace-fetch.ts');
  const mediaTypeRead = wrapper.indexOf('const contentType = structuredJsonContentType(response.headers)');
  const mediaTypeCheck = wrapper.indexOf('if (contentType === null) invalidResponse()', mediaTypeRead);
  const bodyRead = wrapper.indexOf('body = JSON.parse(await response.text())', mediaTypeCheck);
  const traceCheck = wrapper.indexOf('if (!evidence.valid) invalidResponse()', bodyRead);
  const familyCheck = wrapper.indexOf('assertStructuredResponseFamilyForStatus(body, response.status)', traceCheck);
  const machineCheck = wrapper.indexOf('assertTravelportStaysReservationResponseMachineAuthority(body, response.status)', familyCheck);
  const serialize = wrapper.indexOf('const replayBody = serializeStructuredResponseBody(body)', machineCheck);
  const rebuild = wrapper.indexOf('return rebuildStructuredResponse(', serialize);
  assert.ok(
    mediaTypeRead >= 0
    && mediaTypeCheck > mediaTypeRead
    && bodyRead > mediaTypeCheck
    && traceCheck > bodyRead
    && familyCheck > traceCheck
    && machineCheck > familyCheck
    && serialize > machineCheck
    && rebuild > serialize,
  );
  assert.match(wrapper, /mediaType !== CANONICAL_JSON_CONTENT_TYPE/);
  assert.match(wrapper, /charset=utf-8/);
  assert.match(wrapper, /hasReservationResponse && !isSuccessStatus/);
  assert.match(wrapper, /hasErrorResponse && !isStructuredErrorStatus/);
});

test('reservation replay exposes only SF-owned structured and status-only metadata/body authority', async () => {
  const wrapper = await source('src/server/suppliers/travelport-stays-reservation-trace-fetch.ts');
  const statusOnly = await source('src/server/suppliers/travelport-stays-reservation-status-only-response-fetch.ts');
  assert.match(wrapper, /const CANONICAL_JSON_CONTENT_TYPE = 'application\/json'/);
  assert.match(wrapper, /const CANONICAL_JSON_UTF8_CONTENT_TYPE = 'application\/json; charset=utf-8'/);
  assert.match(wrapper, /return CANONICAL_JSON_CONTENT_TYPE/);
  assert.match(wrapper, /\? CANONICAL_JSON_UTF8_CONTENT_TYPE/);
  assert.match(wrapper, /function serializeStructuredResponseBody/);
  assert.match(wrapper, /JSON\.stringify\(value\)/);
  assert.match(wrapper, /const replayBody = serializeStructuredResponseBody\(body\)/);
  assert.doesNotMatch(wrapper, /rawBody/);
  assert.match(wrapper, /function rebuildStructuredResponse/);
  assert.match(wrapper, /headers\.set\('Content-Type', contentType\)/);
  assert.match(wrapper, /headers\.set\('traceId', traceId\)/);
  assert.doesNotMatch(wrapper, /headers: new Headers\(response\.headers\)/);
  assert.match(statusOnly, /function boundedTravelportStaysReservationRetryAfter/);
  assert.match(statusOnly, /MAX_RETRY_AFTER_DELAY_SECONDS = 4_294_967_295/);
  assert.match(statusOnly, /CANONICAL_DELAY_SECONDS_PATTERN = \/\^\(\?:0\|\[1-9\]\\d\*\)\$\//);
  assert.match(statusOnly, /Number\.isSafeInteger\(delaySeconds\)/);
  assert.match(statusOnly, /delaySeconds > MAX_RETRY_AFTER_DELAY_SECONDS/);
  assert.match(statusOnly, /new Date\(parsed\)\.toUTCString\(\) !== value/);

  const replayDoc = await source('docs/travelport-reservation-structured-replay-authority.md');
  assert.match(replayDoc, /original provider JSON text is not replayed/);
  assert.match(replayDoc, /application\/json; charset=utf-8/);
  assert.match(replayDoc, /does not enable the Travelport `reservation` capability/);
});

test('reservation machine authority rejects nested evidence that conflicts with the response family and HTTP status', async () => {
  const guard = await source('src/server/suppliers/travelport-stays-reservation-response-authority.ts');
  assert.ok(guard.includes("responseFamily === 'ReservationResponse' && result.Error !== undefined"));
  assert.ok(guard.includes("responseFamily === 'ErrorResponse'"));
  assert.ok(guard.includes("responseFamily === 'ErrorResponse' && (hasWarning || hasWarnings)"));
  assert.ok(guard.includes("responseFamily === 'ErrorResponse' && response.Reservation !== undefined"));
  assert.ok(guard.includes('httpStatus !== undefined && statusCode !== httpStatus'));
});
