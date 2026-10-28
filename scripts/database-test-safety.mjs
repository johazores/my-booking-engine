const CONFIRMATION_VALUE = 'sf-disposable-test-database';
const DEFAULT_POSTGRES_PORT = '5432';
const RESERVED_DATABASE_NAMES = new Set(['postgres', 'template0', 'template1']);
const TARGET_OVERRIDE_PARAMETERS = new Set(['host', 'hostaddr', 'port', 'database', 'dbname', 'service']);
const LOOPBACK_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  // Common Linux IPv4 and IPv6 loopback host aliases.
  'localhost4',
  'localhost4.localdomain4',
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
  // PostgreSQL is a non-special URL scheme: its URL.hostname preserves legacy
  // numeric IPv4 spellings that the TCP resolver treats as the same address.
  // Canonicalize with a special URL scheme before comparing database targets.
  const originalHost = hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  const canonicalHostname = new URL(`http://${hostname}`).hostname;
  const host = canonicalHostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  // WHATWG URL renders IPv4-mapped IPv6 as ::ffff:hhhh:hhhh.
  // Normalize every mapped IPv4 address, not just loopback. Otherwise a test
  // target like [::ffff:192.168.1.1] bypasses comparison with 192.168.1.1.
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  const normalizedHost = mapped
    ? [
        Number.parseInt(mapped[1], 16) >> 8,
        Number.parseInt(mapped[1], 16) & 255,
        Number.parseInt(mapped[2], 16) >> 8,
        Number.parseInt(mapped[2], 16) & 255,
      ].join('.')
    : host;
  // 127/8, including abbreviated loopback spellings such as 127.1, is local.
  const isIpv4Loopback = /^127(?:\.\d{1,3}){0,3}$/.test(normalizedHost) || /^127(?:\.\d{1,3}){0,3}$/.test(originalHost);
  if (LOOPBACK_HOSTS.has(normalizedHost) || normalizedHost.endsWith('.localhost') || isIpv4Loopback) {
    return 'loopback';
  }
  return normalizedHost;
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

  // Port zero is not a usable PostgreSQL TCP destination. Do not treat it
  // as a separate database target when comparing against the default port.
  if (parsedUrl.port === '0') {
    throw new Error(`${variableName} must use a valid nonzero PostgreSQL port.`);
  }

  let databaseName;
  try {
    databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));
  } catch {
    throw new Error(`${variableName} must have a valid encoded PostgreSQL database name.`);
  }

  if (!databaseName) {
    throw new Error(`${variableName} must identify a database name.`);
  }

  // PostgreSQL stores database identifiers within its default 63-byte limit.
  // Invalid/truncated names must never be compared as if they were distinct.
  if (/[\x00-\x1f\x7f\/\\]/.test(databaseName) || Buffer.byteLength(databaseName, 'utf8') > 63) {
    throw new Error(`${variableName} must identify a valid PostgreSQL database name within 63 UTF-8 bytes.`);
  }

  let hostname;
  try {
    hostname = normalizeHost(parsedUrl.hostname);
  } catch {
    throw new Error(`${variableName} must have a valid PostgreSQL hostname.`);
  }

  return {
    hostname,
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
