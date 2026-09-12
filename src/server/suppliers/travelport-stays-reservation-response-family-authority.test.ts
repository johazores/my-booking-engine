import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { createTravelportStaysReservationTraceAuthorityFetch } from './travelport-stays-reservation-trace-fetch.ts';

const traceId = '9f77a0b5-2614-4f6d-9053-f3a6175343f7';
const url = 'https://api.pp.travelport.net/11/hotel/book/reservations/build';
const requestInit: RequestInit = {
  method: 'POST',
  headers: { E2ETrackingID: `sf-${traceId}` },
  body: '{}',
};

function structuredResponse(family: 'ReservationResponse' | 'ErrorResponse', status: number) {
  const body = family === 'ReservationResponse'
    ? { ReservationResponse: { traceId } }
    : {
        ErrorResponse: {
          traceId,
          Result: {
            '@type': 'Result',
            Error: [{
              '@type': 'ErrorDetail',
              StatusCode: status,
              SourceCode: '13020',
              category: 'VALIDATION',
              SourceID: 'API',
              Message: 'HOTEL RATE PRICE HAS BECOME',
            }],
          },
        },
      };
  return new Response(JSON.stringify(body), {
    status,
    headers: { traceId, 'Content-Type': 'application/json' },
  });
}

async function assertInvalid(response: Response) {
  const wrapped = createTravelportStaysReservationTraceAuthorityFetch((async () => response) as typeof fetch);
  await assert.rejects(
    wrapped(url, requestInit),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
}

test('accepts only response families that agree with structured HTTP status authority', async () => {
  for (const response of [
    structuredResponse('ReservationResponse', 200),
    structuredResponse('ReservationResponse', 201),
    structuredResponse('ErrorResponse', 400),
    structuredResponse('ErrorResponse', 500),
  ]) {
    const wrapped = createTravelportStaysReservationTraceAuthorityFetch((async () => response) as typeof fetch);
    assert.equal((await wrapped(url, requestInit)).status, response.status);
  }

  for (const response of [
    structuredResponse('ReservationResponse', 302),
    structuredResponse('ReservationResponse', 400),
    structuredResponse('ErrorResponse', 200),
    structuredResponse('ErrorResponse', 302),
  ]) await assertInvalid(response);
});
