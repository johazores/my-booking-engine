// A disposable PostgreSQL test run must use the repository's supported Node
// toolchain before Prisma can validate or apply migrations.
export function assertSupportedDatabaseTestRuntime(version = process.versions.node) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match || Number(match[1]) !== 24 || Number(match[2]) < 20) {
    throw new Error(
      `Database integration tests require Node.js >=24.20.0 <25 (received ${version}). Switch to the version pinned in .nvmrc before running migrations.`,
    );
  }
}
