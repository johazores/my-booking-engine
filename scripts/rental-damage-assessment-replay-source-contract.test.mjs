import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const service = fs.readFileSync('src/server/bookings/rental-damage-case-service.ts', 'utf8');
const replay = fs.readFileSync('src/server/bookings/rental-damage-assessment-replay.ts', 'utf8');
const replayTest = fs.readFileSync('src/server/bookings/rental-damage-assessment-replay.test.ts', 'utf8');
const docs = fs.readFileSync('docs/rental-damage-assessment-replay.md', 'utf8');

test('damage assessment service resolves retained replay before fresh lifecycle transition authority', () => {
  assert.match(service, /classifyRentalDamageAssessmentReplay\(current, assessment\)/);
  assert.match(service, /replayDisposition === 'REPLAY'/);
  assert.match(service, /replayDisposition === 'CONFLICT'/);

  const replayIndex = service.indexOf("replayDisposition === 'REPLAY'");
  const transitionIndex = service.indexOf("assertRentalDamageCaseTransition(current.status, 'ASSESSED')");
  assert.ok(replayIndex >= 0 && transitionIndex > replayIndex);
});

test('replay classifier permits only exact retained assessment evidence after later lifecycle transitions', () => {
  assert.match(replay, /current\.status === 'OPEN'/);
  assert.match(replay, /estimatedRepairCostMinor !== null/);
  assert.match(replay, /assessmentNotes !== null/);
  assert.match(replay, /return 'REPLAY'/);
  assert.match(replay, /return 'CONFLICT'/);
  assert.match(replay, /return 'INVALID_TRANSITION'/);

  assert.match(replayTest, /\['ASSESSED', 'WAIVED', 'CLOSED'\]/);
  assert.match(replayTest, /Different retained notes/);
  assert.match(replayTest, /status: 'WAIVED'/);
  assert.match(replayTest, /estimatedRepairCostMinor: null/);
});

test('documentation preserves immutable replay without reopening terminal operational authority', () => {
  assert.match(docs, /exact retry of the assessment write must remain idempotent/i);
  assert.match(docs, /does not change case status, reopen a terminal case/i);
  assert.match(docs, /waived directly from `OPEN` has no retained assessment evidence/i);
  assert.match(docs, /does not add a new damage-case state, payment authority, automatic liability/i);
});
