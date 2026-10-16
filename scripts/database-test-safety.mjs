const CONFIRMATION_VALUE = 'sf-disposable-test-database';
const DEFAULT_POSTGRES_PORT = '5432';
const RESERVED_DATABASE_NAMES = new Set(['postgres', 'template0', 'template1']);
const TARGET_OVERRIDE_PARAMETERS = new Set(['host', 'hostaddr', 'port', 'database', 'dbname', 'service']);
const LOOPBACK_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  // Common Linux IPv6 loopback host aliases.
  'localhost6',
  'localhost6.localdomain6',
  'ip6-localhost',
  'ip6-loopback',
  '::1',
  '0:0:0:0:0:0:0:1',
  '0.0.0.0',
  // Unspecified IPv6 addresses can connect to the local server on Node/POSIX.
  '::',
  '::ffff:0:0',
]);

function normalizeHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  // 127/8, including abbreviated loopback spellings such as 127.1, is local.
  const isIpv4Loopback = /^127(?:\.\d{1,3}){0,3}$/.test(host);
  // WHATWG URL canonicalizes IPv4-mapped IPv6, e.g. [::ffff:127.0.0.1] to [::ffff:7f00:1].
  const isMappedIpv4Loopback = /^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(host);
  if (LOOPBACK_HOSTS.has(host) || isIpv4Loopback || isMappedIpv4Loopback) {
    return 'loopback';
  }
  return host;
}

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

  // Connection-string parsers may honor target fields in query parameters
  // instead of the URL authority/path. Never compare one target and use another.
  if ([...parsedUrl.searchParams.keys()].some((key) => TARGET_OVERRIDE_PARAMETERS.has(key.toLowerCase()))) {
    throw new Error(`${variableName} must not override PostgreSQL host, port, database, or service in URL parameters.`);
  }

  if (!parsedUrl.hostname) {
    throw new Error(`${variableName} must specify an explicit PostgreSQL hostname.`);
  }

  let databaseName;
  try {
    databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, ''));
  } catch {
    throw new Error(`${variableName} must have a valid encoded PostgreSQL database name.`);
  }

  if (!databaseName) {
    throw new Error(`${variableName} must identify a database name.`);
  }

  return {
    hostname: normalizeHost(parsedUrl.hostname),
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
  applicationDatabaseUrls = [],
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

  for (const candidate of [applicationDatabaseUrl, ...applicationDatabaseUrls]) {
    const applicationValue = candidate?.trim();
    if (!applicationValue) continue;

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
