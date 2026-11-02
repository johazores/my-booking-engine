import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const legacyName = 'rental_booking_commercial_amendments_org_booking_status_expiry_idx';
const compactName = 'rental_comm_amend_org_booking_status_expiry_idx';
const storedName = Buffer.from(legacyName, 'utf8').subarray(0, 63).toString('utf8');
const foundation = read('prisma/migrations/20260918083000_rental-booking-commercial-amendment-preparation/migration.sql');
const portability = read('prisma/migrations/20261102084500-rental-commercial-amendment-index-portability/migration.sql');
const schema = read('prisma/rental-booking-commercial-amendments.prisma');

// PostgreSQL stores only 63 bytes of an identifier, including a quoted one.
test('the historical rental commercial-amendment index really truncates', () => {
  assert.equal(Buffer.byteLength(legacyName, 'utf8'), 66);
  assert.equal(storedName, 'rental_booking_commercial_amendments_org_booking_status_expiry_');
  assert.match(
    foundation,
    /CREATE INDEX "rental_booking_commercial_amendments_org_booking_status_expiry_idx"\s+ON "rental_booking_commercial_amendments"\("organizationId", "bookingId", "status", "expiresAt"\)/,
  );
});

test('the repair only renames the exact stored index to a bounded physical name', () => {
  const statements = portability.replace(/--[^\n]*/g, '').trim();
  assert.equal(
    statements.replace(/\s+/g, ' '),
    `ALTER INDEX "${storedName}" RENAME TO "${compactName}";`,
  );
  assert.ok(Buffer.byteLength(compactName, 'utf8') <= 63);
  assert.doesNotMatch(statements, /\b(?:CREATE|DROP|INSERT|UPDATE|DELETE)\b/i);
});

test('Prisma keeps the exact tenant-scoped lookup tuple and other indexes', () => {
  assert.match(
    schema,
    /@@index\(\[organizationId, bookingId, status, expiresAt\], map: "rental_comm_amend_org_booking_status_expiry_idx"\)/,
  );
  assert.doesNotMatch(schema, /map: "rental_booking_commercial_amendments_org_booking_status_expiry_idx"/);
  assert.match(
    schema,
    /@@index\(\[organizationId, status, expiresAt\], map: "rental_booking_commercial_amendments_org_status_expiry_idx"\)/,
  );
  assert.match(schema, /@@unique\(\[id, organizationId\], map: "rental_booking_commercial_amendments_id_org_key"\)/);
});

// Prisma names physical indexes/constraints with map:, and tables/columns with @map/@@map.
function explicitPrismaPhysicalNames(source) {
  return [...source.matchAll(/\bmap:\s*"([^"]+)"|@{1,2}map\s*\(\s*"([^"]+)"\s*\)/g)]
    .map((match) => match[1] ?? match[2]);
}

test('physical-name scanner covers index, field, and table mappings', () => {
  assert.deepEqual(
    explicitPrismaPhysicalNames('@@index([id], map: "lookup_idx")\n@map("field_name")\n@@map("table_name")'),
    ['lookup_idx', 'field_name', 'table_name'],
  );
});

test('all explicit Prisma physical mappings fit PostgreSQL identifier storage', () => {
  const schemaDirectory = new URL('../prisma/', import.meta.url);
  const files = readdirSync(schemaDirectory).filter((name) => name.endsWith('.prisma')).sort();
  assert.ok(files.length > 0);
  const violations = [];
  let checked = 0;
  for (const file of files) {
    const contents = readFileSync(new URL(file, schemaDirectory), 'utf8');
    for (const name of explicitPrismaPhysicalNames(contents)) {
      checked += 1;
      const bytes = Buffer.byteLength(name, 'utf8');
      if (bytes > 63) violations.push(`${file}: ${name} (${bytes} bytes)`);
    }
  }
  assert.ok(checked > 0);
  assert.deepEqual(violations, []);
});
