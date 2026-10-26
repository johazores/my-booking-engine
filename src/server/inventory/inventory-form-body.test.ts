import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INVENTORY_FORM_MAX_FIELDS,
  INVENTORY_FORM_REQUEST_MAX_BYTES,
  readBoundedInventoryFormData,
} from './inventory-form-body.ts';

import { FormBodyValidationError, readBoundedFormDataOrThrow } from '../http/bounded-form-body.ts';

const url = 'https://sf.example/api/inventory/rentals/units';
async function settlesPromptly<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Request cancellation stalled.')), 3_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}


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

test('bounded form ingress rejects corrupted encoded values and names', async () => {
  for (const body of ['name=%', 'name=%GG', 'name=%FF', 'name=%C3%28', '%E0%A4%A=ok', 'name=%ED%A0%80', '=value', 'name=%00', 'na%00me=value']) {
    assert.equal(await readBoundedInventoryFormData(formRequest(body)), null, body);
  }
  const form = await readBoundedInventoryFormData(formRequest('name=Caf%C3%A9+%26+tea&code=RENT%2525'));
  assert.equal(form?.get('name'), 'Café & tea');
  assert.equal(form?.get('code'), 'RENT%25');
});

test('bounded form ingress rejects inaccurate content-length declarations', async () => {
  assert.equal(await readBoundedInventoryFormData(formRequest('name=Kayak', { 'content-length': '0' })), null);
  assert.equal(await readBoundedInventoryFormData(formRequest('name=Kayak', { 'content-length': '20' })), null);
  assert.equal((await readBoundedInventoryFormData(formRequest('name=Kayak', { 'content-length': '10' })))?.get('name'), 'Kayak');
});

test('throwing form adapter reports validation errors without exposing input', async () => {
  await assert.rejects(readBoundedFormDataOrThrow(formRequest('password=%FF')), FormBodyValidationError);
  assert.equal((await readBoundedFormDataOrThrow(formRequest('name=Kayak'))).get('name'), 'Kayak');
});


test('bounded form ingress rejects locked and failing request streams', async () => {
  const locked = formRequest('name=Kayak');
  const reader = locked.body!.getReader();
  try {
    assert.equal(await readBoundedInventoryFormData(locked), null);
    await assert.rejects(readBoundedFormDataOrThrow(locked), FormBodyValidationError);
  } finally {
    reader.releaseLock();
  }

  const failed = new ReadableStream<Uint8Array>({
    start(controller) { controller.error(new Error('internal stream failure')); },
  });
  const request = new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: failed,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  assert.equal(await readBoundedInventoryFormData(request), null);
});


test('bounded form ingress rejects consumed but unlocked request streams', async () => {
  const request = formRequest('name=Kayak');
  const reader = request.body!.getReader();
  while (!(await reader.read()).done) { /* Consume the body without retaining the lock. */ }
  reader.releaseLock();
  assert.equal(request.bodyUsed, true);
  assert.equal(await readBoundedInventoryFormData(request), null);
  await assert.rejects(readBoundedFormDataOrThrow(request), FormBodyValidationError);
});


test('bounded form ingress rejects endless zero-byte chunks and cancels the request stream', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(0)); },
    cancel() { cancelled = true; },
  });
  const request = new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: stream,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  assert.equal(await readBoundedInventoryFormData(request), null);
  assert.equal(cancelled, true);
});


test('bounded form ingress rejects excessive tiny chunks below the byte ceiling', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array([65])); },
    cancel() { cancelled = true; },
  });
  const request = new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: stream,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  assert.equal(await readBoundedInventoryFormData(request), null);
  assert.equal(cancelled, true);
});

test('bounded form ingress never awaits stalled cancellation after exceeding its byte ceiling', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('name=' + 'x'.repeat(INVENTORY_FORM_REQUEST_MAX_BYTES)));
    },
    cancel() { cancelled = true; return new Promise<void>(() => undefined); },
  });
  const request = new Request(url, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: stream, duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  assert.equal(await settlesPromptly(readBoundedInventoryFormData(request)), null);
  assert.equal(cancelled, true);
});
