import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Travelport special create decisions require complete HTTP-consistent provider error evidence', () => {
  const classifier = source('src/server/suppliers/travelport-stays-reservation-create-outcome.ts');

  const envelopeIndex = classifier.indexOf('const envelope = inspectProviderResponseEnvelope(input.body, input.httpStatus)');
  const validityIndex = classifier.indexOf('if (!errors.valid || !warnings.valid) return invalidResponse(providerCorrelationId)');
  const syncIndex = classifier.indexOf('const syncRequiredErrors =');
  const reviewIndex = classifier.indexOf('const reviewErrors =');
  assert.ok(envelopeIndex >= 0 && validityIndex > envelopeIndex && syncIndex > validityIndex && reviewIndex > syncIndex);

  assert.match(classifier, /function inspectProviderResponseEnvelope\(value: unknown, httpStatus: number\)/);
  assert.match(classifier, /const hasReservationResponse = root\.ReservationResponse !== undefined/);
  assert.match(classifier, /const hasErrorResponse = root\.ErrorResponse !== undefined/);
  assert.match(classifier, /hasReservationResponse === hasErrorResponse/);
  assert.match(classifier, /httpStatus >= 200 && httpStatus < 300/);
  assert.match(classifier, /httpStatus >= 400/);
  assert.match(classifier, /if \(!envelope\.valid\) return invalidResponse\(providerCorrelationId\)/);
  assert.match(classifier, /function inspectProviderErrors\(value: unknown, httpStatus: number\)/);
  assert.match(classifier, /const rawStatusCode = error\.StatusCode/);
  assert.match(classifier, /rawStatusCode !== httpStatus/);
  assert.match(classifier, /const rawCategory = error\.category \?\? error\.Category/);
  assert.match(classifier, /typeof rawCategory !== 'string'/);
  assert.match(classifier, /inspectProviderErrors\(input\.body, input\.httpStatus\)/);
  assert.match(classifier, /result\.Error !== undefined\s*\|\| result\.Errors !== undefined/);
  assert.match(classifier, /error\.sourceCode === SYNC_REQUIRED_SOURCE_CODE[\s\S]*?error\.category === 'UNKNOWN'/);
  assert.match(classifier, /error\.category === 'VALIDATION'[\s\S]*?GUARANTEE_CHANGE_SOURCE_CODES\.has\(error\.sourceCode\)[\s\S]*?PRICE_CHANGE_SOURCE_CODE/);
  assert.doesNotMatch(classifier, /error\.category === null/);
  assert.doesNotMatch(classifier, /errors\.sourceCodes\.includes\(SYNC_REQUIRED_SOURCE_CODE\)/);
});

test('Travelport known-locator reservation evidence rejects unsupported embedded Result evidence', () => {
  const parser = source('src/server/suppliers/travelport-stays-reservation-response.ts');

  const responseIndex = parser.indexOf('const response = record(root.ReservationResponse)');
  const resultGuardIndex = parser.indexOf('assertSupportedResultEvidence(response)');
  const reservationIndex = parser.indexOf('const reservation = record(response.Reservation)');
  assert.ok(responseIndex >= 0 && resultGuardIndex > responseIndex && reservationIndex > resultGuardIndex);
  assert.match(parser, /function assertSupportedResultEvidence\(response: RecordValue\)/);
  assert.match(parser, /if \(response\.Result === undefined\) return/);
  assert.match(parser, /result\.Error !== undefined\s*\|\| result\.Errors !== undefined/);
  assert.match(parser, /const hasWarning = result\.Warning !== undefined/);
  assert.match(parser, /const hasWarnings = result\.Warnings !== undefined/);
  assert.match(parser, /if \(hasWarning && hasWarnings\)/);
  assert.match(parser, /!Array\.isArray\(warningValues\) \|\| warningValues\.length > MAX_WARNINGS/);
  assert.match(parser, /boundedProviderValue\(warning\.Message, 512\)/);
  assert.match(parser, /embedded result error evidence/);
  assert.match(parser, /conflicting result warning evidence/);
});

test('Travelport create error authority documentation keeps partial and contradictory envelopes fail-closed', () => {
  const doc = source('docs/travelport-create-error-authority.md');
  assert.match(doc, /older.*StatusCode.*Message/is);
  assert.match(doc, /newer.*StatusCode.*SourceCode.*Category/is);
  assert.match(doc, /StatusCode.*actual HTTP/is);
  assert.match(doc, /mutually exclusive/i);
  assert.match(doc, /2xx.*ReservationResponse/is);
  assert.match(doc, /4xx.*5xx.*ErrorResponse/is);
  assert.match(doc, /ReservationResponse\.Result\.Error/is);
  assert.match(doc, /warning-only.*allowed/is);
  assert.match(doc, /13034.*UNKNOWN/is);
  assert.match(doc, /13016.*13017.*13018.*13020.*VALIDATION/is);
  assert.match(doc, /mixed.*INVALID_RESPONSE/is);
  assert.match(doc, /`reservation` capability remains disabled/i);
});
