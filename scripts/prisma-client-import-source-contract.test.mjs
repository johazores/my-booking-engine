import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function collectTypeScriptFiles(relativeDirectory) {
  const absoluteDirectory = path.join(root, relativeDirectory);
  const files = [];

  for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTypeScriptFiles(relativePath));
      continue;
    }
    if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      files.push(relativePath);
    }
  }

  return files;
}

test('server code imports Prisma types from the repository generated client', () => {
  const schema = read('prisma/schema.prisma');
  assert.match(schema, /provider\s*=\s*"prisma-client"/);
  assert.match(schema, /output\s*=\s*"\.\.\/src\/generated\/prisma"/);

  const offenders = collectTypeScriptFiles('src/server').filter((relativePath) => {
    const source = read(relativePath);
    return /from\s+['"]@prisma\/client['"]/.test(source);
  });

  assert.deepEqual(
    offenders,
    [],
    `Server modules must import generated Prisma types from src/generated/prisma, not @prisma/client: ${offenders.join(', ')}`,
  );

  const rentalPaymentService = read('src/server/payments/rental-payment-service.ts');
  assert.match(rentalPaymentService, /import type \{ Prisma \} from '\.\.\/\.\.\/generated\/prisma\/client\.ts';/);
});
