import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Travelport special create decisions require valid homogeneous provider error evidence', () => {
  const classifier = source('src/server/suppliers/travelport-stays-reservation-create-outcome.ts');

  const validityIndex = classifier.indexOf('if (!errors.valid || !warnings.valid) return invalidResponse(providerCorrelationId)');
  const syncIndex = classifier.indexOf('const syncRequiredErrors =');
  const reviewIndex = classifier.indexOf('const reviewErrors =');
  assert.ok(validityIndex >= 0 && syncIndex > validityIndex && reviewIndex > syncIndex);

  assert.match(classifier, /errors\.errors\.every\([\s\S]*?error\.sourceCode === SYNC_REQUIRED_SOURCE_CODE[\s\S]*?error\.category === null \|\| error\.category === 'UNKNOWN'/);
  assert.match(classifier, /errors\.errors\.every\([\s\S]*?error\.category === null \|\| error\.category === 'VALIDATION'[\s\S]*?GUARANTEE_CHANGE_SOURCE_CODES\.has\(error\.sourceCode\)[\s\S]*?PRICE_CHANGE_SOURCE_CODE/);
  assert.doesNotMatch(classifier, /errors\.sourceCodes\.includes\(SYNC_REQUIRED_SOURCE_CODE\)/);
});

test('Travelport create error authority documentation keeps capability closed', () => {
  const doc = source('docs/travelport-create-error-authority.md');
  assert.match(doc, /13034.*UNKNOWN/is);
  assert.match(doc, /13016.*13017.*13018.*13020.*VALIDATION/is);
  assert.match(doc, /mixed.*INVALID_RESPONSE/is);
  assert.match(doc, /`reservation` capability remains disabled/i);
});
