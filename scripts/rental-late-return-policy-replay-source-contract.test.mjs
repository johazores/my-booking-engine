import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const service = read('src/server/pricing/rental-late-return-policy-service.ts');
const docs = read('docs/rental-late-return-policy.md');

test('late-return policy exact historical replay is resolved before fresh parent and version authority', () => {
  const replayVersion = service.indexOf('const replayVersion = requested.expectedVersion + 1;');
  const replayLookup = service.indexOf('version: replayVersion', replayVersion);
  const replayMatch = service.indexOf('rentalLateReturnPolicyMatches(replayRevision, requested)', replayLookup);
  const replayReturn = service.indexOf('revision: replayRevision, idempotent: true as const', replayMatch);
  const activeParentGate = service.indexOf("if (unitType.status !== 'ACTIVE')", replayReturn);
  const staleVersionGate = service.indexOf('if (currentVersion !== requested.expectedVersion)', activeParentGate);
  const revisionCreate = service.indexOf('rentalLateReturnPolicyRevision.create', staleVersionGate);

  assert.ok(replayVersion >= 0, 'historical replay version is derived from optimistic write position');
  assert.ok(replayLookup > replayVersion, 'the exact authored next version is loaded');
  assert.ok(replayMatch > replayLookup, 'historical evidence must exactly match normalized policy authority');
  assert.ok(replayReturn > replayMatch, 'exact retained evidence returns idempotently');
  assert.ok(activeParentGate > replayReturn, 'historical replay resolves before fresh ACTIVE parent authority');
  assert.ok(staleVersionGate > activeParentGate, 'fresh stale-version rejection remains after parent authority');
  assert.ok(revisionCreate > staleVersionGate, 'new authority is authored only after fresh gates');
});

test('historical replay lookup remains tenant and unit-type scoped', () => {
  const replayLookupStart = service.indexOf('transaction.rentalLateReturnPolicyRevision.findFirst({', service.indexOf('const replayVersion'));
  const replayLookupEnd = service.indexOf('}),', service.indexOf('version: replayVersion'));
  const replayLookup = service.slice(replayLookupStart, replayLookupEnd);

  assert.match(replayLookup, /organizationId: input\.organizationId/);
  assert.match(replayLookup, /unitTypeId: unitType\.id/);
  assert.match(replayLookup, /version: replayVersion/);
});

test('documentation distinguishes historical replay from fresh policy authority', () => {
  assert.match(docs, /exact retry of an already-authored revision/i);
  assert.match(docs, /newer revisions/i);
  assert.match(docs, /unit type was later archived/i);
  assert.match(docs, /does not make that historical revision current/i);
  assert.match(docs, /fresh policy authority still requires the parent unit type to be `ACTIVE`/i);
});
