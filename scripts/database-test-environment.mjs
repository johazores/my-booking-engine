import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

// Inspect local application configuration without loading its test target or
// explicit safety confirmation into process.env.
const APPLICATION_ENV_FILES = [
  '.env',
  '.env.local',
  '.env.development',
  '.env.development.local',
  '.env.production',
  '.env.production.local',
  '.env.test',
  '.env.test.local',
];

// URL host/database authority must not be silently replaced by libpq-style
// environment defaults, and session options must not disable integrity checks.
export const DISALLOWED_POSTGRES_ENV_KEYS = [
  'PGHOST', 'PGHOSTADDR', 'PGDATABASE', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS',
];

// prisma.config.ts imports dotenv/config. A custom path can load connection
// settings that the test preflight never inspected, while override=true can
// replace the validated DATABASE_URL in a Prisma subprocess. A different
// encoding can make dotenv read .env differently from our UTF-8 preflight.
export const DISALLOWED_DOTENV_CONFIG_KEYS = ['DOTENV_CONFIG_PATH', 'DOTENV_CONFIG_OVERRIDE', 'DOTENV_CONFIG_ENCODING'];

export function assertNoDotenvConfigurationOverrides(environment = process.env, source = 'process environment') {
  for (const key of DISALLOWED_DOTENV_CONFIG_KEYS) {
    if (typeof environment[key] === 'string' && environment[key].trim()) {
      throw new Error(`${key} in ${source} is not supported for disposable database tests; dotenv/config could load unreviewed connection settings or override the validated DATABASE_URL.`);
    }
  }
}

export function assertNoPostgresConnectionOverrides(environment = process.env, source = 'process environment') {
  for (const key of DISALLOWED_POSTGRES_ENV_KEYS) {
    if (typeof environment[key] === 'string' && environment[key].trim()) {
      throw new Error(`${key} in ${source} is not supported for disposable database tests; configure the connection through explicit PostgreSQL URLs.`);
    }
  }
}

export function readLocalApplicationDatabaseUrls(rootDirectory = process.cwd()) {
  const urls = [];
  for (const filename of APPLICATION_ENV_FILES) {
    let content;
    try {
      content = readFileSync(join(rootDirectory, filename), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw new Error(`Cannot read ${filename} while checking the disposable database target.`);
    }

    let parsed;
    try {
      parsed = parseEnv(content);
    } catch {
      // Never include the raw parse error; local environment files can hold secrets.
      throw new Error(`Cannot parse ${filename} while checking the disposable database target.`);
    }
    assertNoPostgresConnectionOverrides(parsed, filename);
    assertNoDotenvConfigurationOverrides(parsed, filename);
    // Prisma's dotenv loader can import PGPORT after the runner preflight.
    // Reject local overrides rather than comparing URLs against the wrong port.
    if (parsed.PGPORT?.trim()) {
      throw new Error(`PGPORT in ${filename} is not supported for disposable database tests; specify ports in PostgreSQL URLs.`);
    }
    const url = parsed.DATABASE_URL?.trim();
    if (url) urls.push(url);
  }
  return urls;
}
