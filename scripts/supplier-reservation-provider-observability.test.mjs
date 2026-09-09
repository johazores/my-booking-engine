import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildHospitalitySupplierReservationProviderLogRecord,
  createHospitalitySupplierReservationProviderObservation,
} from '../src/server/suppliers/hospitality-supplier-reservation-observability.ts';

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

test('supplier provider completion log contains only reviewed correlation fields', () => {
  const record = buildHospitalitySupplierReservationProviderLogRecord({
    requestCorrelationId: '5e2b72da-060b-4c87-a630-d68dbd5d14ad',
    organizationId: '4c8fb076-d79b-4e4f-83d3-41221657795e',
    provider: 'travelport-stays',
    durationMs: 13.6,
    result: { status: 'SUCCEEDED', providerResult: 'FOUND' },
    now: () => new Date('2026-09-06T08:00:00.000Z'),
  });

  assert.deepEqual(record, {
    timestamp: '2026-09-06T08:00:00.000Z',
    level: 'info',
    event: 'supplier.reservation-recovery.provider-request.completed',
    requestCorrelationId: '5e2b72da-060b-4c87-a630-d68dbd5d14ad',
    organizationId: '4c8fb076-d79b-4e4f-83d3-41221657795e',
    provider: 'travelport-stays',
    operation: 'reservation.retrieve',
    outcome: 'succeeded',
    durationMs: 14,
    providerResult: 'FOUND',
  });

  const serialized = JSON.stringify(record);
  for (const forbidden of [
    'providerReservationReference',
    'supplierConfirmationReference',
    'providerCorrelationId',
    'accessToken',
    'credentials',
    'headers',
    'requestBody',
    'responseBody',
    'cardNumber',
    'cvv',
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('provider failures are warning-level normalized records and unsafe identifiers fail closed', () => {
  const record = buildHospitalitySupplierReservationProviderLogRecord({
    requestCorrelationId: 'not a uuid',
    organizationId: 'not a uuid',
    provider: 'travelport stays\nsecret',
    durationMs: -5,
    result: { status: 'FAILED', failureCode: 'TIMEOUT' },
    now: () => new Date('2026-09-06T08:00:01.000Z'),
  });

  assert.equal(record.level, 'warn');
  assert.equal(record.outcome, 'failed');
  assert.equal(record.failureCode, 'TIMEOUT');
  assert.equal(record.durationMs, 0);
  assert.equal(record.requestCorrelationId, 'invalid-request-correlation-id');
  assert.equal(record.organizationId, 'invalid-organization-id');
  assert.equal(record.provider, 'unknown-provider');

  const malformedFailure = buildHospitalitySupplierReservationProviderLogRecord({
    requestCorrelationId: '5e2b72da-060b-4c87-a630-d68dbd5d14ad',
    organizationId: '4c8fb076-d79b-4e4f-83d3-41221657795e',
    provider: 'travelport-stays',
    durationMs: Number.NaN,
    result: { status: 'FAILED', failureCode: 'SECRET_SHOULD_NOT_LOG' },
    now: () => new Date('2026-09-06T08:00:01.000Z'),
  });
  assert.equal(malformedFailure.failureCode, 'INVALID_RESPONSE');
  assert.equal(malformedFailure.durationMs, 0);
  assert.equal(JSON.stringify(malformedFailure).includes('SECRET_SHOULD_NOT_LOG'), false);
});

test('malformed successful provider results fail closed without copying untrusted values into logs', () => {
  const record = buildHospitalitySupplierReservationProviderLogRecord({
    requestCorrelationId: '5e2b72da-060b-4c87-a630-d68dbd5d14ad',
    organizationId: '4c8fb076-d79b-4e4f-83d3-41221657795e',
    provider: 'travelport-stays',
    durationMs: 3,
    result: { status: 'SUCCEEDED', providerResult: 'SECRET_SHOULD_NOT_LOG' },
    now: () => new Date('2026-09-06T08:00:01.500Z'),
  });
  const serialized = JSON.stringify(record);
  assert.equal(record.level, 'warn');
  assert.equal(record.outcome, 'failed');
  assert.equal(record.failureCode, 'INVALID_RESPONSE');
  assert.equal('providerResult' in record, false);
  assert.equal(serialized.includes('SECRET_SHOULD_NOT_LOG'), false);
});

test('supplier provider observation emits one completion record only', () => {
  let tick = 1_000;
  const observation = createHospitalitySupplierReservationProviderObservation({
    requestCorrelationId: '5e2b72da-060b-4c87-a630-d68dbd5d14ad',
    organizationId: '4c8fb076-d79b-4e4f-83d3-41221657795e',
    provider: 'travelport-stays',
    nowMs: () => {
      const current = tick;
      tick += 25;
      return current;
    },
    now: () => new Date('2026-09-06T08:00:02.000Z'),
  });

  const captured = captureConsole('info', () => {
    const first = observation.finish({ status: 'SUCCEEDED', providerResult: 'NOT_FOUND' });
    const second = observation.finish({ status: 'SUCCEEDED', providerResult: 'FOUND' });
    return { first, second };
  });

  assert.equal(captured.lines.length, 1);
  assert.equal(captured.value.first?.durationMs, 25);
  assert.equal(captured.value.first?.providerResult, 'NOT_FOUND');
  assert.equal(captured.value.second, null);
});

test('reconciliation observes only real provider I/O and rejects unrecognized or identity-conflicting provider results', () => {
  const source = readFileSync(new URL('../src/server/suppliers/hospitality-supplier-reservation-reconciliation-service.ts', import.meta.url), 'utf8');
  const claimIndex = source.indexOf('claimHospitalitySupplierReservationReconciliation');
  const providerGuardIndex = source.indexOf("input.provider.code !== claim.reservation.providerCode");
  const observerIndex = source.indexOf('createHospitalitySupplierReservationProviderObservation({');
  const providerIoIndex = source.indexOf('input.provider.retrieveReservation');
  const catchIndex = source.indexOf('} catch (error) {', providerIoIndex);
  const postCatchValidationIndex = source.indexOf("if (!result || typeof result !== 'object'");
  const correlationNormalizationIndex = source.indexOf(
    'normalizeHospitalitySupplierReservationCorrelationId(result.providerCorrelationId)',
    postCatchValidationIndex,
  );
  const durableSupplierCheckIndex = source.indexOf(
    'supplierConfirmationMatchesDurableReservation(',
    correlationNormalizationIndex,
  );
  const foundSuccessIndex = source.indexOf("providerResult: 'FOUND'", durableSupplierCheckIndex);

  assert.ok(claimIndex >= 0);
  assert.ok(providerGuardIndex > claimIndex);
  assert.ok(observerIndex > providerGuardIndex);
  assert.ok(providerIoIndex > observerIndex);
  assert.ok(catchIndex > providerIoIndex);
  assert.ok(postCatchValidationIndex > catchIndex);
  assert.ok(correlationNormalizationIndex > postCatchValidationIndex);
  assert.ok(durableSupplierCheckIndex > correlationNormalizationIndex);
  assert.ok(foundSuccessIndex > durableSupplierCheckIndex);
  assert.doesNotMatch(source.slice(catchIndex, postCatchValidationIndex), /status: 'FOUND'|status: 'NOT_FOUND'/);
  assert.match(source, /requestCorrelationId: claim\.attempt\.id/);
  assert.match(source, /if \(result\.status === 'FOUND'\)/);
  assert.match(source, /if \(result\.status === 'NOT_FOUND'\)/);
  assert.match(source, /const failureCode = error instanceof HospitalitySupplierProviderError \? error\.code : 'PROVIDER_UNAVAILABLE';/);
  assert.match(source, /providerObservation\.finish\(\{ status: 'FAILED', failureCode \}\);/);
  assert.match(
    source.slice(durableSupplierCheckIndex, foundSuccessIndex),
    /providerObservation\.finish\(\{ status: 'FAILED', failureCode: 'INVALID_RESPONSE' \}\)/,
  );
  assert.match(
    source.slice(durableSupplierCheckIndex, foundSuccessIndex),
    /HOSPITALITY_SUPPLIER_CONFIRMATION_MISMATCH_FAILURE_CODE/,
  );

  const observationCalls = [...source.matchAll(/providerObservation\.finish/g)];
  assert.equal(observationCalls.length, 7);
  assert.match(source, /createHospitalitySupplierReservationProviderObservation\(\{\n\s+requestCorrelationId: claim\.attempt\.id,\n\s+organizationId: input\.organizationId,\n\s+provider: claim\.reservation\.providerCode,\n\s+\}\)/);
});
