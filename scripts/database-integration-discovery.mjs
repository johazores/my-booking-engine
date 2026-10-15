import { lstatSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export function discoverDatabaseIntegrationTests(rootDirectory = process.cwd()) {
  const serverDirectory = join(rootDirectory, 'src', 'server');
  for (const directory of [join(rootDirectory, 'src'), serverDirectory]) {
    const entry = lstatSync(directory);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error('Database integration test roots must be real directories.');
    }
  }
  const integrationTests = [];

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile() && entry.name.endsWith('.integration.ts')) {
        integrationTests.push(relative(rootDirectory, path).split(sep).join('/'));
      }
    }
  }

  visit(serverDirectory);
  if (integrationTests.length === 0) {
    throw new Error('No database integration tests found under src/server.');
  }

  return integrationTests.sort();
}

export function assertRequiredDatabaseIntegrationTests(requiredTests, discoveredTests) {
  const discovered = new Set(discoveredTests);
  if (discovered.size !== discoveredTests.length || new Set(requiredTests).size !== requiredTests.length) {
    throw new Error('Duplicate database integration test entries.');
  }
  const missing = requiredTests.filter((path) => !discovered.has(path));
  if (missing.length) throw new Error(`Required database integration tests missing: ${missing.join(', ')}`);
}
