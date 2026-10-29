import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const suites = [
  ['src/server/integrations/integration.integration.ts', ['integration', 'auditEvent']],
  ['src/server/inventory/tour-inventory.integration.ts', ['tourAddon', 'tourDeparture', 'tourProduct']],
  ['src/server/inventory/appointment-inventory.integration.ts', ['appointmentStaffService', 'appointmentSchedule', 'appointmentStaff', 'appointmentService']],
  ['src/server/bookings/hospitality-booking.integration.ts', ['hospitalityBooking', 'hospitalityAvailabilityHold', 'hospitalityProperty']],
];

test('integration, inventory, and booking database fixtures guard partial setup', () => {
  for (const [path, models] of suites) {
    const source = readFileSync(new URL(path, root), 'utf8');
    const guard = source.indexOf('  try {', source.indexOf('const runId = crypto.randomUUID()'));
    assert.ok(guard >= 0 && source.indexOf('await db.user.create(') > guard, path + ': setup guard');
    assert.match(source, /const userIds = Array\.from\(\{ length: 3 \}, \(\) => crypto\.randomUUID\(\)\)/, path);
    assert.match(source, /const organizationIds = Array\.from\(\{ length: 2 \}, \(\) => crypto\.randomUUID\(\)\)/, path);
    for (let i = 0; i < 3; i += 1) assert.ok(source.includes('id: userIds[' + i + ']'), path + ': user ' + i);
    for (let i = 0; i < 2; i += 1) assert.ok(source.includes('id: organizationIds[' + i + ']'), path + ': organization ' + i);
    const cleanup = source.slice(source.lastIndexOf('\n  } finally {\n') + 1);
    for (const model of ['organizationMembership', 'organization', 'user', ...models]) {
      assert.ok(cleanup.includes(model + '.deleteMany'), path + ': ' + model);
    }
    assert.ok(cleanup.includes('organizationIds') && cleanup.includes('userIds'), path + ': cleanup scope');
    assert.ok(cleanup.indexOf('organizationMembership.deleteMany') < cleanup.indexOf('organization.deleteMany'), path);
    assert.ok(cleanup.indexOf('organization.deleteMany') < cleanup.indexOf('user.deleteMany'), path);
    assert.match(cleanup, /\} finally \{\s+await db\.\$disconnect\(\);/, path);
    assert.equal((source.match(/await db\.\$disconnect\(\)/g) ?? []).length, 1, path);
  }
});
