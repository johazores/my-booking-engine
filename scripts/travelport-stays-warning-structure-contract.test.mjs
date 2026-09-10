import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const createOutcomeSource = readFileSync(
  new URL('../src/server/suppliers/travelport-stays-reservation-create-outcome.ts', import.meta.url),
  'utf8',
);
const retrieveResponseSource = readFileSync(
  new URL('../src/server/suppliers/travelport-stays-reservation-response.ts', import.meta.url),
  'utf8',
);

function assertSharedWarningGuards(source, label) {
  assert.match(
    source,
    /rawResultType !== undefined[\s\S]*MAX_RESULT_TYPE_LENGTH[\s\S]*!== 'Result'/,
    `${label} must reject present malformed Result discriminators`,
  );
  assert.match(
    source,
    /warningValues\.length < 1[\s\S]*warningValues\.length > MAX_WARNINGS/,
    `${label} must reject explicit empty and oversized warning collections`,
  );
  assert.match(
    source,
    /rawWarningType !== undefined[\s\S]*MAX_WARNING_TYPE_LENGTH[\s\S]*!== 'Warning'/,
    `${label} must reject present malformed Warning discriminators`,
  );
  assert.match(
    source,
    /rawStatusCode !== undefined[\s\S]*typeof rawStatusCode !== 'number'[\s\S]*Number\.isInteger\(rawStatusCode\)[\s\S]*rawStatusCode < 0[\s\S]*rawStatusCode > MAX_WARNING_STATUS_CODE/,
    `${label} must reject malformed warning StatusCode evidence`,
  );
  assert.match(
    source,
    /typeof warning\.Message !== 'string' \|\| \/\[\\u0000-\\u001f\\u007f\]\//,
    `${label} must reject control characters in warning messages`,
  );
}

test('Create and Sync warning authority validates the shared current warning structure when metadata is present', () => {
  assertSharedWarningGuards(createOutcomeSource, 'Create/Sync classifier');
  assert.match(
    createOutcomeSource,
    /messages\.push\(message\.toUpperCase\(\)\)/,
    'Create/Sync must not collapse internal whitespace before exact commercial-warning comparison',
  );
  assert.doesNotMatch(
    createOutcomeSource,
    /messages\.push\(message\.replace\(\/\\s\+\/g/,
    'Create/Sync must not normalize arbitrary whitespace into commercial-warning authority',
  );
});

test('known-locator Retrieve applies the same warning structure boundary', () => {
  assertSharedWarningGuards(retrieveResponseSource, 'known-locator Retrieve parser');
});
