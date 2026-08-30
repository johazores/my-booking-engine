const CONFIRMATION_VALUE = 'sf-disposable-test-database';
const DEFAULT_POSTGRES_PORT = '5432';
const RESERVED_DATABASE_NAMES = new Set(['postgres', 'template0', 'template1']);

function parsePostgresDatabaseTarget(value, variableName) {
  let parsedUrl;

  try {
    parsedUrl = new URL(value);
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL URL.`);
  }

  if (!['postgres:', 'postgresql:'].includes(parsedUrl.protocol)) {
    throw new Error(`${variableName} must use PostgreSQL.`);
  }

  const databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, ''));

  if (!databaseName) {
    throw new Error(`${variableName} must identify a database name.`);
  }

  return {
    hostname: parsedUrl.hostname.toLowerCase(),
    port: parsedUrl.port || DEFAULT_POSTGRES_PORT,
    databaseName,
  };
}

function databaseTargetsMatch(left, right) {
  return (
    left.hostname === right.hostname &&
    left.port === right.port &&
    left.databaseName === right.databaseName
  );
}

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

  const testTarget = parsePostgresDatabaseTarget(value, 'TEST_DATABASE_URL');

  if (RESERVED_DATABASE_NAMES.has(testTarget.databaseName.toLowerCase())) {
    throw new Error(
      'TEST_DATABASE_URL must not target a PostgreSQL maintenance or template database.',
    );
  }

  const applicationValue = applicationDatabaseUrl?.trim();

  if (applicationValue) {
    const applicationTarget = parsePostgresDatabaseTarget(applicationValue, 'DATABASE_URL');

    if (databaseTargetsMatch(testTarget, applicationTarget)) {
      throw new Error(
        'TEST_DATABASE_URL must target a different PostgreSQL database from DATABASE_URL, regardless of credentials or connection options.',
      );
    }
  }

  return value;
}

export { CONFIRMATION_VALUE as DATABASE_TEST_CONFIRMATION };
