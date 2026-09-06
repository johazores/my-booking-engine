import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('Travelport retrieve and future create share one privacy-minimal reservation response authority parser', async () => {
  const parser = await source('src/server/suppliers/travelport-stays-reservation-response.ts');
  const recovery = await source('src/server/suppliers/travelport-stays-reservation-recovery-provider.ts');

  assert.match(recovery, /parseTravelportStaysReservationResponse/);
  assert.match(recovery, /expectedProviderReservationReference: reference/);
  assert.doesNotMatch(recovery, /function parseReservationResponse/);

  assert.match(parser, /providerReservationReference/);
  assert.match(parser, /supplierConfirmationReference/);
  assert.match(parser, /providerCorrelationId/);
  assert.match(parser, /travelportReceipts\[0\]!\.status !== 'Confirmed'/);
  assert.match(parser, /supplierReceipts\.some\(\(receipt\) => receipt\.status !== 'Confirmed'\)/);
  assert.doesNotMatch(parser, /CardNumber|SeriesCode|PaymentCard|FormOfPayment/);
});

test('response evidence durability cannot make Travelport reservation creation reachable', async () => {
  const parser = await source('src/server/suppliers/travelport-stays-reservation-response.ts');
  const recovery = await source('src/server/suppliers/travelport-stays-reservation-recovery-provider.ts');
  const docs = await source('docs/travelport-reservation-response-evidence.md');
  const schema = await source('prisma/hospitality-supplier-reservations.prisma');

  for (const value of [parser, recovery]) {
    assert.doesNotMatch(value, /book\/reservations\/build/);
    assert.doesNotMatch(value, /acceptPriceChangeInd|acceptGuaranteeChangeInd/);
  }
  assert.match(schema, /supplierConfirmationReference\s+String\?/);
  assert.match(docs, /supplier reservation ledger now persists the optional supplier confirmation reference/i);
  assert.match(docs, /no Travelport reservation POST/i);
  assert.match(docs, /PCI-safe form-of-payment\/guarantee strategy/i);
});
