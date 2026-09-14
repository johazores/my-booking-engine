import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertAppointmentArchiveConfirmation,
  assertAppointmentRemoveConfirmation,
  normalizeAppointmentScheduleInput,
  normalizeAppointmentServiceCode,
  normalizeAppointmentServiceInput,
  normalizeAppointmentStaffInput,
} from './appointment-domain.ts';

test('normalizes appointment services with bounded duration and buffers', () => {
  assert.deepEqual(normalizeAppointmentServiceInput({
    name: '  Initial   consultation ',
    code: ' consult-01 ',
    description: '  First visit ',
    durationMinutes: '60',
    bufferBeforeMinutes: '10',
    bufferAfterMinutes: '15',
  }), {
    name: 'Initial consultation',
    code: 'CONSULT-01',
    description: 'First visit',
    durationMinutes: 60,
    bufferBeforeMinutes: 10,
    bufferAfterMinutes: 15,
  });
  assert.throws(() => normalizeAppointmentServiceInput({
    name: 'Too long',
    code: 'LONG',
    description: '',
    durationMinutes: '1200',
    bufferBeforeMinutes: '240',
    bufferAfterMinutes: '240',
  }), /cannot exceed 24 hours/);
});

test('normalizes appointment staff and requires a real IANA timezone', () => {
  assert.deepEqual(normalizeAppointmentStaffInput({
    name: '  Jamie   Cruz ',
    code: ' jamie ',
    description: ' Senior specialist ',
    timezone: 'Asia/Manila',
  }), {
    name: 'Jamie Cruz',
    code: 'JAMIE',
    description: 'Senior specialist',
    timezone: 'Asia/Manila',
  });
  assert.throws(() => normalizeAppointmentStaffInput({
    name: 'Jamie',
    code: 'JAMIE',
    description: '',
    timezone: 'Mars/Olympus',
  }), /IANA timezone/);
});

test('normalizes same-day weekly schedule windows including 24:00 end', () => {
  assert.deepEqual(normalizeAppointmentScheduleInput({
    dayOfWeek: '1',
    startsAt: '09:30',
    endsAt: '18:00',
  }), { dayOfWeek: 1, startsAtMinute: 570, endsAtMinute: 1080 });
  assert.deepEqual(normalizeAppointmentScheduleInput({
    dayOfWeek: '6',
    startsAt: '20:00',
    endsAt: '24:00',
  }), { dayOfWeek: 6, startsAtMinute: 1200, endsAtMinute: 1440 });
  assert.throws(() => normalizeAppointmentScheduleInput({
    dayOfWeek: '7',
    startsAt: '09:00',
    endsAt: '10:00',
  }), /between 0 and 6/);
  assert.throws(() => normalizeAppointmentScheduleInput({
    dayOfWeek: '2',
    startsAt: '18:00',
    endsAt: '09:00',
  }), /same day/);
});

test('normalizes service codes and explicit destructive confirmations', () => {
  assert.equal(normalizeAppointmentServiceCode(' consult-01 '), 'CONSULT-01');
  assert.doesNotThrow(() => assertAppointmentArchiveConfirmation(' archive '));
  assert.doesNotThrow(() => assertAppointmentRemoveConfirmation(' remove '));
  assert.throws(() => assertAppointmentArchiveConfirmation('yes'), /ARCHIVE/);
  assert.throws(() => assertAppointmentRemoveConfirmation('yes'), /REMOVE/);
});
