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
