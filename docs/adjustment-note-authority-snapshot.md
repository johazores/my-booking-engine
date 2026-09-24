# Adjustment-note authority snapshot consistency

The shared hospitality adjustment-note authority validator can run inside a caller-owned PostgreSQL transaction. A compatibility entry point opens one RepeatableRead transaction for callers that do not already own one.

Cancellation source evidence, cancellation-after-amendment authority, and commercial-amendment source chains are now verified through the same caller transaction for each validation request. Commercial chain groups no longer open separate snapshots.

Tenant scope remains mandatory on every database read. Immutable document fingerprints, chronology, frozen issue-time evidence, and terminal refund authority remain fail-closed. This change does not make paginated presentation reads a substitute for legal completeness.

Full repository validation still requires the supported Node 24 toolchain and an explicitly disposable PostgreSQL environment.
