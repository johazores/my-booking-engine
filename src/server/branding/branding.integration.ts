import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Branding integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('tenant branding enforces authorization, normalization, audit history, and public-safe reads', async () => {
  const [{ db }, branding] = await Promise.all([
    import('../database.ts'),
    import('./branding-service.ts'),
  ]);

  const runId = crypto.randomUUID();
  const admin = await db.user.create({ data: { email: `branding-admin-${runId}@example.test`, status: 'ACTIVE' } });
  const outsider = await db.user.create({ data: { email: `branding-outsider-${runId}@example.test`, status: 'ACTIVE' } });
  const slug = `branding-${runId}`.slice(0, 63);
  const organization = await db.organization.create({
    data: { name: 'Branding Test', slug, kind: 'OTHER', timezone: 'UTC', currency: 'USD' },
  });
  await db.organizationMembership.create({
    data: { organizationId: organization.id, userId: admin.id, status: 'ACTIVE', role: 'ADMIN' },
  });

  const input = {
    logoUrl: 'https://cdn.example.com/logo.svg',
    faviconUrl: 'https://cdn.example.com/favicon.ico',
    primaryColor: '#3366FF',
    secondaryColor: '#112233',
    accentColor: '#22AA88',
    fontFamily: 'SYSTEM',
    contactEmail: 'INFO@EXAMPLE.COM',
    contactPhone: '+1 555 0100',
    websiteUrl: 'https://example.com',
    emailFromName: 'Branding Test Reservations',
    emailReplyTo: 'BOOKINGS@EXAMPLE.COM',
    publicBookingTitle: 'Book direct',
    publicBookingDescription: 'Reserve directly with Branding Test.',
    customDomain: `book-${runId}.example.test`,
  };

  try {
    await assert.rejects(
      branding.updateOrganizationBranding({ organizationId: organization.id, actorUserId: outsider.id, branding: input }),
      /permission/i,
    );

    await branding.updateOrganizationBranding({
      organizationId: organization.id,
      actorUserId: admin.id,
      branding: input,
    });

    const saved = await branding.readOrganizationBranding({ organizationId: organization.id, userId: admin.id });
    assert.equal(saved?.primaryColor, '#3366ff');
    assert.equal(saved?.contactEmail, 'info@example.com');
    assert.equal(saved?.emailReplyTo, 'bookings@example.com');
    assert.equal(saved?.customDomain, input.customDomain.toLowerCase());
    assert.match(saved?.fontStack ?? '', /system-ui/);

    const publicBranding = await branding.readPublicOrganizationBrandingBySlug(slug);
    assert.equal(publicBranding?.name, 'Branding Test');
    assert.equal(publicBranding?.publicBookingTitle, 'Book direct');

    const audit = await db.auditEvent.findFirst({
      where: { organizationId: organization.id, action: 'organization.branding.updated' },
    });
    assert.equal(audit?.actorUserId, admin.id);
  } finally {
    await db.auditEvent.deleteMany({ where: { organizationId: organization.id } });
    await db.organizationMembership.deleteMany({ where: { organizationId: organization.id } });
    await db.organization.deleteMany({ where: { id: organization.id } });
    await db.user.deleteMany({ where: { id: { in: [admin.id, outsider.id] } } });
  }
});
