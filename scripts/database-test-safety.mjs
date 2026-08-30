const CONFIRMATION_VALUE = 'sf-disposable-test-database';

export function validateDisposableTestDatabase({
  testDatabaseUrl,
  applicationDatabaseUrl,
  confirmation,
}) {
  const value = testDatabaseUrl?.trim();

  if (!value) {
    throw new Error('TEST_DATABASE_URL is required for database integration tests.');
  }

  if (confirmation !== CONFIRMATION_VALUE) {
    throw new Error(
      `SF_DATABASE_TEST_CONFIRM must equal ${CONFIRMATION_VALUE} before database integration tests can run.`,
    );
  }

  if (applicationDatabaseUrl?.trim() === value) {
    throw new Error(
      'TEST_DATABASE_URL must be different from DATABASE_URL so integration tests cannot target the normal application database.',
    );
  }

  const parsedUrl = new URL(value);

  if (!['postgres:', 'postgresql:'].includes(parsedUrl.protocol)) {
    throw new Error('TEST_DATABASE_URL must use PostgreSQL.');
  }

  if (!parsedUrl.pathname || parsedUrl.pathname === '/') {
    throw new Error('TEST_DATABASE_URL must identify a database name.');
  }

  return value;
}

export { CONFIRMATION_VALUE as DATABASE_TEST_CONFIRMATION };
