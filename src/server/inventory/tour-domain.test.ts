import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertTourArchiveConfirmation,
  normalizeTourAddonInput,
  normalizeTourDepartureInput,
  normalizeTourProductInput,
} from './tour-domain.ts';

test('normalizes tour and package inventory without weakening tenant-neutral identifiers', () => {
  assert.deepEqual(normalizeTourProductInput({
    kind: ' package ',
    name: '  Island   escape ',
    code: ' island-01 ',
    description: '  Two day   guided package ',
    timezone: 'Asia/Manila',
    meetingPoint: '  Pier 1 ',
  }), {
    kind: 'PACKAGE',
    name: 'Island escape',
    code: 'ISLAND-01',
    description: 'Two day guided package',
    timezone: 'Asia/Manila',
    meetingPoint: 'Pier 1',
  });
});

test('requires explicit-offset schedule instants and bounded positive capacity', () => {
  const departure = normalizeTourDepartureInput({
    startsAt: '2026-10-05T08:00:00+08:00',
    endsAt: '2026-10-05T17:00:00+08:00',
    capacity: '24',
  });
  assert.equal(departure.startsAt.toISOString(), '2026-10-05T00:00:00.000Z');
  assert.equal(departure.endsAt.toISOString(), '2026-10-05T09:00:00.000Z');
  assert.equal(departure.capacity, 24);
  assert.throws(() => normalizeTourDepartureInput({ startsAt: '2026-10-05T08:00', endsAt: '2026-10-05T17:00+08:00', capacity: '24' }), /explicit UTC offset/);
  assert.throws(() => normalizeTourDepartureInput({ startsAt: '2026-10-05T08:00:00+08:00', endsAt: '2026-10-05T07:00:00+08:00', capacity: '24' }), /after departure start/);
  assert.throws(() => normalizeTourDepartureInput({ startsAt: '2026-10-05T08:00:00+08:00', endsAt: '2026-11-06T08:00:00+08:00', capacity: '24' }), /31 days/);
  assert.throws(() => normalizeTourDepartureInput({ startsAt: '2026-10-05T08:00:00+08:00', endsAt: '2026-10-05T17:00:00+08:00', capacity: '0' }), /between 1 and 10000/);
});

test('normalizes add-ons and bounds per-booking quantity', () => {
  assert.deepEqual(normalizeTourAddonInput({
    name: '  Airport   transfer ',
    code: ' transfer ',
    description: '  Shared van ',
    maxQuantityPerBooking: '4',
  }), {
    name: 'Airport transfer',
    code: 'TRANSFER',
    description: 'Shared van',
    maxQuantityPerBooking: 4,
  });
  assert.throws(() => normalizeTourAddonInput({ name: 'Transfer', code: 'transfer', description: '', maxQuantityPerBooking: '101' }), /between 1 and 100/);
});

test('rejects invalid product kinds, timezones, codes and archive confirmations', () => {
  assert.throws(() => normalizeTourProductInput({ kind: 'EXPERIENCE', name: 'Walk', code: 'WALK', description: '', timezone: 'UTC', meetingPoint: '' }), /TOUR or PACKAGE/);
  assert.throws(() => normalizeTourProductInput({ kind: 'TOUR', name: 'Walk', code: 'bad code', description: '', timezone: 'UTC', meetingPoint: '' }), /letters, numbers/);
  assert.throws(() => normalizeTourProductInput({ kind: 'TOUR', name: 'Walk', code: 'WALK', description: '', timezone: 'Mars/Olympus', meetingPoint: '' }), /IANA timezone/);
  assert.doesNotThrow(() => assertTourArchiveConfirmation(' archive '));
  assert.throws(() => assertTourArchiveConfirmation('yes'), /Type ARCHIVE/);
});
