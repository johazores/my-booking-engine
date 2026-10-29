// Verify that Prisma migrations and raw PostgreSQL catalog tests address the
// same disposable database and public schema before any migration is applied.
// Also reject role/database defaults that disable integrity enforcement.
export class DatabaseTestSessionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DatabaseTestSessionError';
  }
}

export function assertDisposableDatabaseSession(testDatabaseUrl, row) {
  const expectedDatabaseName = decodeURIComponent(new URL(testDatabaseUrl).pathname.slice(1));
  if (row?.databaseName !== expectedDatabaseName) {
    throw new DatabaseTestSessionError('Disposable PostgreSQL connection resolved to a different database than TEST_DATABASE_URL.');
  }
  if (row.schemaName !== 'public') {
    throw new DatabaseTestSessionError('Disposable PostgreSQL tests require current_schema() to be public.');
  }
  if (row.replicationRole !== 'origin') {
    throw new DatabaseTestSessionError('Disposable PostgreSQL tests require session_replication_role to be origin so normal integrity triggers are active.');
  }
  if (row.rowSecurity !== 'on') {
    throw new DatabaseTestSessionError('Disposable PostgreSQL tests require row_security to be on.');
  }
}

export async function verifyDisposableDatabaseSession(testDatabaseUrl) {
  let client;
  let connected = false;
  try {
    // Load only after runtime, URL, and local dotenv safety checks have passed.
    const { default: pg } = await import('pg');
    client = new pg.Client({
      connectionString: testDatabaseUrl,
      connectionTimeoutMillis: 5000,
      query_timeout: 5000,
    });
    await client.connect();
    connected = true;
    const result = await client.query(`
      SELECT current_database() AS "databaseName",
             current_schema() AS "schemaName",
             current_setting('session_replication_role') AS "replicationRole",
             current_setting('row_security') AS "rowSecurity"
    `);
    if (result.rows.length !== 1) {
      throw new DatabaseTestSessionError('Could not establish the disposable PostgreSQL database and schema identity.');
    }
    assertDisposableDatabaseSession(testDatabaseUrl, result.rows[0]);
  } catch (error) {
    if (error instanceof DatabaseTestSessionError) throw error;
    // Driver errors can contain connection details; do not echo them or attach a cause.
    throw new DatabaseTestSessionError('Could not verify the disposable PostgreSQL session before migrations. Check the database connection and permissions.');
  } finally {
    if (connected) {
      try {
        await client.end();
      } catch {
        throw new DatabaseTestSessionError('Could not close the disposable PostgreSQL verification connection.');
      }
    }
  }
}
