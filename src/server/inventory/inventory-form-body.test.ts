import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INVENTORY_FORM_MAX_FIELDS,
  INVENTORY_FORM_REQUEST_MAX_BYTES,
  readBoundedInventoryFormData,
} from './inventory-form-body.ts';

const url = 'https://sf.example/api/inventory/rentals/units';

function formRequest(body: BodyInit, headers?: Record<string, string>) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body,
  });
}

test('inventory form ingress preserves normal urlencoded text fields', async () => {
  const form = await readBoundedInventoryFormData(formRequest('name=Kayak&city=Quezon+City'));
  assert.equal(form?.get('name'), 'Kayak');
  assert.equal(form?.get('city'), 'Quezon City');
});

test('inventory form ingress accepts small browser multipart text fields', async () => {
  const input = new FormData();
  input.set('name', 'Café rental');
  input.set('code', 'RENT-1');
  const form = await readBoundedInventoryFormData(new Request(url, { method: 'POST', body: input }));
  assert.equal(form?.get('name'), 'Café rental');
  assert.equal(form?.get('code'), 'RENT-1');
});

test('inventory form ingress rejects declared and actual oversized bodies', async () => {
  const limit = INVENTORY_FORM_REQUEST_MAX_BYTES;
  assert.equal(await readBoundedInventoryFormData(formRequest('name=ok', { 'content-length': String(limit + 1) })), null);
  assert.equal((await readBoundedInventoryFormData(formRequest('name=' + 'x'.repeat(limit - 5))))?.get('name')?.length, limit - 5);
  assert.equal(await readBoundedInventoryFormData(formRequest('name=' + 'x'.repeat(limit))), null);
  assert.equal(await readBoundedInventoryFormData(formRequest('name=' + 'x'.repeat(limit), { 'content-length': '4' })), null);
  assert.equal(await readBoundedInventoryFormData(formRequest('name=ok', { 'content-length': 'not-a-number' })), null);
  assert.equal(await readBoundedInventoryFormData(formRequest('name=ok', { 'content-length': '9999999999999999999999' })), null);
});

test('inventory form ingress rejects invalid media types, malformed encoding and missing body', async () => {
  assert.equal(await readBoundedInventoryFormData(formRequest('name=ok', { 'content-type': 'application/json' })), null);
  assert.equal(await readBoundedInventoryFormData(formRequest('name=ok'), 0), null);
  assert.equal(await readBoundedInventoryFormData(new Request(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } })), null);
  assert.equal(await readBoundedInventoryFormData(formRequest(new Uint8Array([0xff, 0xfe]))), null);
  assert.equal(await readBoundedInventoryFormData(formRequest('broken', { 'content-type': 'multipart/form-data; boundary=missing' })), null);
});

test('inventory form ingress rejects uploaded files rather than silently converting them to empty text', async () => {
  const input = new FormData();
  input.set('name', 'Kayak');
  input.set('upload', new Blob(['content']), 'photo.txt');
  assert.equal(await readBoundedInventoryFormData(new Request(url, { method: 'POST', body: input })), null);
});

test('inventory form ingress rejects ambiguous duplicate names and excessive field counts', async () => {
  assert.equal(await readBoundedInventoryFormData(formRequest('name=Kayak&name=Canoe')), null);
  const allowed = Array.from({ length: INVENTORY_FORM_MAX_FIELDS }, (_, i) => `field${i}=ok`).join('&');
  assert.equal((await readBoundedInventoryFormData(formRequest(allowed)))?.get('field63'), 'ok');
  assert.equal(await readBoundedInventoryFormData(formRequest(`${allowed}&field64=ok`)), null);
  assert.equal(await readBoundedInventoryFormData(formRequest(`${'n'.repeat(101)}=ok`)), null);
});
