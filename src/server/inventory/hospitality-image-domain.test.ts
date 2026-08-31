import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeHospitalityImageInput } from './hospitality-image-domain.ts';

test('normalizes secure hospitality image metadata', () => {
  assert.deepEqual(normalizeHospitalityImageInput({
    url: ' https://cdn.example.test/hotel/pool.jpg ',
    altText: ' Pool   terrace at sunset ',
    sortOrder: '12',
    isPrimary: 'on',
  }), {
    url: 'https://cdn.example.test/hotel/pool.jpg',
    altText: 'Pool terrace at sunset',
    sortOrder: 12,
    isPrimary: true,
  });
});

test('rejects unsafe or invalid image inputs', () => {
  assert.throws(() => normalizeHospitalityImageInput({ url: 'http://example.test/image.jpg', altText: 'Room', sortOrder: '0', isPrimary: '' }), /HTTPS URL/);
  assert.throws(() => normalizeHospitalityImageInput({ url: 'https://user:secret@example.test/image.jpg', altText: 'Room', sortOrder: '0', isPrimary: '' }), /without embedded credentials/);
  assert.throws(() => normalizeHospitalityImageInput({ url: 'https://example.test/image.jpg', altText: ' ', sortOrder: '0', isPrimary: '' }), /alt text/);
  assert.throws(() => normalizeHospitalityImageInput({ url: 'https://example.test/image.jpg', altText: 'Room', sortOrder: '-1', isPrimary: '' }), /sort order/);
});
