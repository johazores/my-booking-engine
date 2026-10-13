# Rental ancillary retained-reader integrity

Damage and late-return settlement readers now validate retained manual evidence independently of its stored request fingerprint. They reject unsupported operation/status/provider, noncanonical external and refund-source references, incorrect source attribution, invalid timestamps, nonpositive amounts, invalid currency or fingerprint format, and idempotency keys that do not match the server-derived operation/reference identity.

Security-bond financial and booking pickup/cancellation readers share the pure `isValidRentalSecurityBondRetainedTransaction` validator for the same invariants. The booking operational projection also verifies forfeiture source collection identity and deterministic forfeiture idempotency. These are fail-closed reads; historical evidence is never silently repaired.

Tenant authorization and resource scoping remain at the service/repository boundaries. The dedicated security-bond forfeiture reader still needs the shared validation wired into its retained collection/release path; do not claim it is covered by the new shared validator until that change lands.

Validation required before production release: Node 24 typecheck, lint, unit/source-contract tests, Prisma generate/validate, production build, and the checked-in migration/database tests against an explicitly disposable PostgreSQL target. These checks have not run in the current connector-only environment. GitHub Actions are not used.
