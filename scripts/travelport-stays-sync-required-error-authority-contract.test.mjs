import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

function source(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('Travelport 13034 authority stays pinned to the documented HTTP 500 UNKNOWN contract', () => {
  const classifier = source('src/server/suppliers/travelport-stays-reservation-create-outcome.ts');
  const authorityDoc = source('docs/travelport-create-error-authority.md');
  const outcomeDoc = source('docs/travelport-stays-create-outcome-classification.md');

  assert.match(classifier, /SYNC_REQUIRED_SOURCE_CODE = '13034'/);
  assert.match(classifier, /SYNC_REQUIRED_STATUS_CODE = 500/);
  assert.match(
    classifier,
    /error\.sourceCode === SYNC_REQUIRED_SOURCE_CODE[\s\S]*error\.category === 'UNKNOWN'[\s\S]*error\.statusCode === SYNC_REQUIRED_STATUS_CODE/,
  );

  for (const doc of [authorityDoc, outcomeDoc]) {
    assert.match(doc, /13034[\s\S]{0,700}(?:HTTP|StatusCode)[\s\S]{0,80}500/i);
    assert.match(doc, /13034[\s\S]{0,700}UNKNOWN/i);
    assert.match(doc, /13034[\s\S]{0,1800}(?:TRAVELPORT_SELL_UNCERTAIN|never retry authority|does not.*retry)/i);
  }
});