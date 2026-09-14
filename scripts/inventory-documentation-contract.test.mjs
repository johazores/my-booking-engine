import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repositoryRoot = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, repositoryRoot), 'utf8');
}

test('repository overview reflects the implemented non-hospitality inventory foundations', async () => {
  const readme = await source('README.md');

  assert.match(readme, /tenant-owned tour\/package inventory with departure schedules/i);
  assert.match(readme, /tenant-owned appointment inventory with services, staff/i);
  assert.match(readme, /tenant-owned rental inventory with unit types, operating locations/i);
  assert.match(readme, /customer-facing availability, pricing, booking, payment, and provider\/calendar workflows for the implemented tour, appointment, and rental inventory foundations/i);
  assert.doesNotMatch(readme, /tours, appointments, rentals, marketplace capabilities, and other advanced business modules after the shared booking foundation is proven/i);
});

test('product roadmap separates implemented inventory from later business workflows', async () => {
  const roadmap = await source('docs/product-roadmap.md');

  assert.match(roadmap, /Internal inventory — hospitality, tour, appointment, and rental foundations implemented in code/i);
  assert.match(roadmap, /Implemented tour\/package inventory includes tenant-owned products, dated departure schedules/i);
  assert.match(roadmap, /Implemented appointment inventory includes tenant-owned services and staff/i);
  assert.match(roadmap, /Implemented rental inventory includes tenant-owned unit types\/products, operating locations/i);
  assert.match(roadmap, /These are internal inventory foundations only/i);
  assert.match(roadmap, /Advanced business modules — later workflows/i);
  assert.doesNotMatch(roadmap, /Tours, appointments, rentals, and marketplace inventory remain separate later business modules/i);
});

test('architecture names current inventory and supplier boundaries without reviving stale planned claims', async () => {
  const architecture = await source('docs/architecture.md');

  assert.match(architecture, /tour\/package inventory: tenant-owned products, dated departures/i);
  assert.match(architecture, /appointment inventory: tenant-owned services, staff/i);
  assert.match(architecture, /rental inventory: tenant-owned unit types, operating locations/i);
  assert.match(architecture, /Non-hospitality inventory boundary/);
  assert.match(architecture, /first external supplier\/GDS adapter is implemented server-side for Travelport TripServices Stays/i);
  assert.doesNotMatch(architecture, /remaining business-specific inventory\/workflows for tours, appointments, rentals/i);
  assert.doesNotMatch(architecture, /largest remaining cross-provider dependency is the first real external supplier\/GDS adapter/i);
});
