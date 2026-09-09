import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Travelport special create decisions require complete HTTP-consistent provider error evidence', () => {
  const classifier = source('src/server/suppliers/travelport-stays-reservation-create-outcome.ts');

  const validityIndex = classifier.indexOf('if (!errors.valid || !warnings.valid) return invalidResponse(providerCorrelationId)');
  const syncIndex = classifier.indexOf('const syncRequiredErrors =');
  const reviewIndex = classifier.indexOf('const reviewErrors =');
  assert.ok(validityIndex >= 0 && syncIndex > validityIndex && reviewIndex > syncIndex);

  assert.match(classifier, /function inspectProviderErrors\(value: unknown, httpStatus: number\)/);
  assert.match(classifier, /const rawStatusCode = error\.StatusCode/);
  assert.match(classifier, /rawStatusCode !== httpStatus/);
  assert.match(classifier, /const rawCategory = error\.category \?\? error\.Category/);
  assert.match(classifier, /typeof rawCategory !== 'string'/);
  assert.match(classifier, /inspectProviderErrors\(input\.body, input\.httpStatus\)/);
  assert.match(classifier, /error\.sourceCode === SYNC_REQUIRED_SOURCE_CODE[\s\S]*?error\.category === 'UNKNOWN'/);
  assert.match(classifier, /error\.category === 'VALIDATION'[\s\S]*?GUARANTEE_CHANGE_SOURCE_CODES\.has\(error\.sourceCode\)[\s\S]*?PRICE_CHANGE_SOURCE_CODE/);
  assert.doesNotMatch(classifier, /error\.category === null/);
  assert.doesNotMatch(classifier, /errors\.sourceCodes\.includes\(SYNC_REQUIRED_SOURCE_CODE\)/);
});

test('Travelport create error authority documentation keeps partial error envelopes fail-closed', () => {
  const doc = source('docs/travelport-create-error-authority.md');
  assert.match(doc, /older.*StatusCode.*Message/is);
  assert.match(doc, /newer.*StatusCode.*SourceCode.*Category/is);
  assert.match(doc, /StatusCode.*actual HTTP/is);
  assert.match(doc, /13034.*UNKNOWN/is);
  assert.match(doc, /13016.*13017.*13018.*13020.*VALIDATION/is);
  assert.match(doc, /mixed.*INVALID_RESPONSE/is);
  assert.match(doc, /`reservation` capability remains disabled/i);
});
