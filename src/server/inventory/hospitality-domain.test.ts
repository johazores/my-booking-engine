import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertInventoryArchiveConfirmation,
  normalizeAmenityInput,
  normalizePropertyInput,
  normalizeRoomInput,
  normalizeRoomTypeInput,
  parseInventoryPage,
  parseInventoryPageSize,
} from './hospitality-domain.ts';

test('normalizes hospitality inventory identifiers and property fields', () => {
  assert.deepEqual(normalizePropertyInput({
    name: '  Northstar   Hotel ',
    code: ' nst-01 ',
    timezone: 'Asia/Manila',
    addressLine1: ' 1 Main Street ',
    city: ' Quezon City ',
    region: '',
    postalCode: '1100',
    countryCode: 'ph',
  }), {
    name: 'Northstar Hotel',
    code: 'NST-01',
    timezone: 'Asia/Manila',
    addressLine1: '1 Main Street',
    city: 'Quezon City',
    region: null,
    postalCode: '1100',
    countryCode: 'PH',
  });
});

test('validates room type occupancy, room codes, and amenity fields', () => {
  const roomType = normalizeRoomTypeInput({ propertyId: ' property ', name: ' Deluxe King ', code: ' dlx ', maxOccupancy: '3', bedsDescription: ' 1 king bed ' });
  assert.equal(roomType.code, 'DLX');
  assert.equal(roomType.maxOccupancy, 3);
  assert.equal(normalizeRoomInput({ propertyId: 'p', roomTypeId: 'rt', code: ' 101 ', floor: ' 1 ' }).code, '101');
  assert.deepEqual(normalizeAmenityInput({ name: '  Free   WiFi ', code: ' wifi ' }), { name: 'Free WiFi', code: 'WIFI' });
  assert.throws(() => normalizeRoomTypeInput({ propertyId: 'p', name: 'Bad', code: 'BAD', maxOccupancy: '0', bedsDescription: '' }), /between 1 and 50/);
  assert.throws(() => normalizeRoomInput({ propertyId: 'p', roomTypeId: 'rt', code: 'bad code', floor: '' }), /letters, numbers/);
  assert.throws(() => normalizeAmenityInput({ name: '', code: 'WIFI' }), /Amenity name/);
});

test('requires explicit archive confirmation and bounds pagination', () => {
  assert.doesNotThrow(() => assertInventoryArchiveConfirmation(' archive '));
  assert.throws(() => assertInventoryArchiveConfirmation('yes'), /Type ARCHIVE/);
  assert.equal(parseInventoryPage('-2'), 1);
  assert.equal(parseInventoryPage('4'), 4);
  assert.equal(parseInventoryPageSize('500'), 50);
  assert.equal(parseInventoryPageSize('0'), 20);
});
