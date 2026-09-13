import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');

test('reservation response family authority is bound before downstream machine parsing', async () => {
  const wrapper = await source('src/server/suppliers/travelport-stays-reservation-trace-fetch.ts');
  const mediaTypeCheck = wrapper.indexOf('if (!hasStructuredJsonContentType(response.headers)) invalidResponse()');
  const bodyRead = wrapper.indexOf('rawBody = await response.text()', mediaTypeCheck);
  const traceCheck = wrapper.indexOf('if (!evidence.valid) invalidResponse()', bodyRead);
  const familyCheck = wrapper.indexOf('assertStructuredResponseFamilyForStatus(body, response.status)', traceCheck);
  const machineCheck = wrapper.indexOf('assertTravelportStaysReservationResponseMachineAuthority(body, response.status)', familyCheck);
  const rebuild = wrapper.indexOf('return rebuildResponse(response, rawBody)', machineCheck);
  assert.ok(
    mediaTypeCheck >= 0
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

test('reservation machine authority rejects nested evidence that conflicts with the response family and HTTP status', async () => {
  const guard = await source('src/server/suppliers/travelport-stays-reservation-response-authority.ts');
  assert.ok(guard.includes("responseFamily === 'ReservationResponse' && result.Error !== undefined"));
  assert.ok(guard.includes("responseFamily === 'ErrorResponse'"));
  assert.ok(guard.includes("responseFamily === 'ErrorResponse' && (hasWarning || hasWarnings)"));
  assert.ok(guard.includes("responseFamily === 'ErrorResponse' && response.Reservation !== undefined"));
  assert.ok(guard.includes('httpStatus !== undefined && statusCode !== httpStatus'));
});
