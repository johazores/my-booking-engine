import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

const reservationIoFiles = [
  'src/server/suppliers/travelport-stays-reservation-create-executor.ts',
  'src/server/suppliers/travelport-stays-reservation-sync-executor.ts',
  'src/server/suppliers/travelport-stays-reservation-recovery-provider.ts',
];

test('all reservation I/O constructors consume the shared materialized authority', async () => {
  for (const path of reservationIoFiles) {
    const text = await source(path);
    assert.match(text, /materializeTravelportStaysReservationIoConstructorAuthority\(input\)/, path);
    assert.match(text, /this\.#credentials = authority\.credentials/, path);
    assert.match(text, /authority\.cacheKey/, path);
    assert.match(text, /this\.#fetchImpl = authority\.fetchImpl \?\? fetch/, path);
    assert.match(text, /normalizeTimeout\(authority\.timeoutMs\)/, path);
    assert.match(text, /this\.#now = authority\.now \?\? \(\(\) => new Date\(\)\)/, path);
    assert.doesNotMatch(text, /this\.#credentials = input\.credentials/, path);
    assert.doesNotMatch(text, /this\.#fetchImpl = input\.fetchImpl/, path);
  }
});

test('reservation I/O materializer snapshots credentials and sanitizes caller failures', async () => {
  const authority = await source('src/server/suppliers/travelport-stays-constructor-authority.ts');
  assert.match(authority, /export function materializeTravelportStaysReservationIoConstructorAuthority/);
  assert.match(authority, /credentials: credentialsSnapshot\(input\.credentials\)/);
  assert.match(authority, /cacheKey: input\.cacheKey/);
  assert.match(authority, /catch \{\s*invalidConstructorAuthority\(\);\s*\}/s);
});

test('constructor documentation covers reservation writes and preserves activation gates', async () => {
  const docs = await source('docs/travelport-stays-constructor-authority.md');
  assert.match(docs, /Create, Sync, and known-locator recovery/);
  assert.match(docs, /remaining public reservation occurrences were Create, Booking\.com Sync, and known-locator recovery/);
  assert.match(docs, /does not enable the Travelport `reservation` capability/);
  assert.match(docs, /PCI-safe FormOfPayment\/guarantee source/);
  assert.match(docs, /`13034` \/ locator-less recovery semantics/);
});
