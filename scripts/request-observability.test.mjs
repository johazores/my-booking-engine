import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  REQUEST_ID_HEADER,
  appendRequestReference,
  isSafeRequestId,
} from '../src/lib/request-correlation.ts';
import {
  buildStructuredRequestLogRecord,
  createRequestObservation,
  resolveRequestId,
} from '../src/server/observability/request-observability.ts';

const taxInvoiceRoute = readFileSync(new URL('../app/api/bookings/hospitality/[booking-id]/tax-invoices/route.ts', import.meta.url), 'utf8');
const cancellationRoute = readFileSync(new URL('../app/api/bookings/hospitality/[booking-id]/adjustment-notes/route.ts', import.meta.url), 'utf8');
const commercialRoute = readFileSync(new URL('../app/api/bookings/hospitality/[booking-id]/commercial-amendments/[amendment-id]/adjustment-note/route.ts', import.meta.url), 'utf8');
const taxInvoiceAction = readFileSync(new URL('../src/components/booking-tax-invoice-action.tsx', import.meta.url), 'utf8');
const cancellationAction = readFileSync(new URL('../src/components/cancellation-adjustment-note-action.tsx', import.meta.url), 'utf8');
const commercialAction = readFileSync(new URL('../src/components/commercial-amendment-adjustment-note-action.tsx', import.meta.url), 'utf8');

function captureConsole(method, run) {
  const original = console[method];
  const lines = [];
  console[method] = (line) => lines.push(line);
  try {
    return { value: run(), lines };
  } finally {
    console[method] = original;
  }
}

test('request ids preserve only bounded safe inbound correlation values', () => {
  const accepted = 'sf-client.2026-09-05:abc123';
  assert.equal(resolveRequestId(new Request('https://sf.example.test', { headers: { [REQUEST_ID_HEADER]: accepted } })), accepted);
  assert.equal(isSafeRequestId(accepted), true);

  for (const rejected of ['short', 'contains space', 'contains\ttab', 'x'.repeat(129)]) {
    const generated = resolveRequestId(new Request('https://sf.example.test', { headers: { [REQUEST_ID_HEADER]: rejected } }));
    assert.match(generated, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.notEqual(generated, rejected);
  }
});

test('structured completion logs are one safe whitelisted record and echo request id', () => {
  const requestId = 'sf-request.2026-09-05:0001';
  const observer = createRequestObservation(new Request('https://sf.example.test/private?access=never-log-this', {
    method: 'POST',
    headers: { [REQUEST_ID_HEADER]: requestId, authorization: 'Bearer never-log-this' },
  }), {
    operation: 'hospitality-tax-invoice.issue',
    documentType: 'tax-invoice',
  });

  const captured = captureConsole('info', () => observer.finish(new Response('{}', { status: 201 }), {
    organizationId: '4c8fb076-d79b-4e4f-83d3-41221657795e',
    provider: 'stripe',
  }));
  assert.equal(captured.value.headers.get(REQUEST_ID_HEADER), requestId);
  assert.equal(captured.lines.length, 1);
  const record = JSON.parse(captured.lines[0]);
  assert.equal(record.requestId, requestId);
  assert.equal(record.operation, 'hospitality-tax-invoice.issue');
  assert.equal(record.outcome, 'succeeded');
  assert.equal(record.level, 'info');
  assert.equal(record.statusCode, 201);
  assert.equal(record.documentType, 'tax-invoice');
  assert.equal(record.organizationId, '4c8fb076-d79b-4e4f-83d3-41221657795e');
  assert.equal(record.provider, 'stripe');
  assert.equal('url' in record, false);
  assert.equal('headers' in record, false);
  assert.equal('authorization' in record, false);
  assert.equal('body' in record, false);
  assert.doesNotMatch(captured.lines[0], /never-log-this/);
});

test('status classification is stable and unsafe optional context fails closed', () => {
  const warning = buildStructuredRequestLogRecord({
    requestId: 'sf-request.2026-09-05:0002',
    operation: 'hospitality-adjustment-note.issue',
    statusCode: 409,
    durationMs: 12.6,
    scope: { organizationId: 'unsafe organization id', bookingReference: 'SF-2026-1001' },
  });
  assert.equal(warning.level, 'warn');
  assert.equal(warning.outcome, 'rejected');
  assert.equal(warning.durationMs, 13);
  assert.equal(warning.organizationId, undefined);
  assert.equal(warning.bookingReference, 'SF-2026-1001');

  const failure = buildStructuredRequestLogRecord({
    requestId: 'sf-request.2026-09-05:0003',
    operation: 'hospitality-adjustment-note.issue',
    statusCode: 500,
    durationMs: -10,
  });
  assert.equal(failure.level, 'error');
  assert.equal(failure.outcome, 'failed');
  assert.equal(failure.durationMs, 0);
});

test('client error references expose only a validated response correlation id', () => {
  const response = new Response(null, { headers: { [REQUEST_ID_HEADER]: 'sf-request.2026-09-05:0004' } });
  assert.equal(appendRequestReference('Issuance failed.', response), 'Issuance failed. Request reference: sf-request.2026-09-05:0004');

  const unsafe = new Response(null, { headers: { [REQUEST_ID_HEADER]: 'unsafe request id' } });
  assert.equal(appendRequestReference('Issuance failed.', unsafe), 'Issuance failed.');
});

test('all production legal-document write routes finish through request observation', () => {
  for (const source of [taxInvoiceRoute, cancellationRoute, commercialRoute]) {
    assert.match(source, /createRequestObservation\(request,/);
    assert.match(source, /if \(context\.response\) return observation\.finish\(context\.response\);/);
    assert.match(source, /return observation\.finish\(/);
    assert.match(source, /catch \(error\) \{\n\s+return observation\.finish\(/);
    assert.doesNotMatch(source, /console\.(?:log|info|warn|error)/);
  }
  assert.match(taxInvoiceRoute, /hospitality-tax-invoice\.issue/);
  assert.match(cancellationRoute, /hospitality-cancellation-adjustment-note\.issue/);
  assert.match(commercialRoute, /hospitality-commercial-adjustment-note\.issue/);
});

test('legal-document actions surface the response request reference on failures', () => {
  for (const source of [taxInvoiceAction, cancellationAction, commercialAction]) {
    assert.match(source, /appendRequestReference/);
    assert.match(source, /throw new Error\(appendRequestReference\(/);
  }
});
