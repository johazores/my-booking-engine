import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');

const createClassifier = source('src/server/suppliers/travelport-stays-reservation-create-outcome.ts');
const retrieveParser = source('src/server/suppliers/travelport-stays-reservation-response.ts');

test('commercial response-envelope authority distinguishes field absence from explicit null', () => {
  assert.match(createClassifier, /const hasReservationResponse = root\.ReservationResponse !== undefined;/);
  assert.match(createClassifier, /const hasErrorResponse = root\.ErrorResponse !== undefined;/);
  assert.doesNotMatch(createClassifier, /root\.ReservationResponse !== undefined && root\.ReservationResponse !== null/);
  assert.doesNotMatch(createClassifier, /root\.ErrorResponse !== undefined && root\.ErrorResponse !== null/);
  assert.match(createClassifier, /if \(!root \|\| root\.ErrorResponse === undefined\)/);
});

test('commercial Result authority treats explicit null values as malformed presentation', () => {
  assert.match(createClassifier, /if \(response\.Result === undefined\)/);
  assert.match(createClassifier, /result\.Error !== undefined\s*\|\| result\.Errors !== undefined/);
  assert.match(createClassifier, /const hasWarning = result\.Warning !== undefined;/);
  assert.match(createClassifier, /const hasWarnings = result\.Warnings !== undefined;/);
  assert.doesNotMatch(createClassifier, /response\.Result === undefined \|\| response\.Result === null/);
});

test('known-locator Retrieve applies the same absent-not-null envelope and Result rules', () => {
  assert.match(retrieveParser, /if \(root\.ErrorResponse !== undefined\)/);
  assert.match(retrieveParser, /if \(response\.Result === undefined\) return;/);
  assert.match(retrieveParser, /result\.Error !== undefined\s*\|\| result\.Errors !== undefined/);
  assert.match(retrieveParser, /const hasWarning = result\.Warning !== undefined;/);
  assert.match(retrieveParser, /const hasWarnings = result\.Warnings !== undefined;/);
  assert.doesNotMatch(retrieveParser, /response\.Result === undefined \|\| response\.Result === null/);
});

test('Retrieve passive placeholder requires Locator to be genuinely omitted', () => {
  assert.match(retrieveParser, /if \(confirmation\.Locator !== undefined\) return false;/);
  assert.doesNotMatch(retrieveParser, /confirmation\.Locator !== undefined && confirmation\.Locator !== null/);
});
