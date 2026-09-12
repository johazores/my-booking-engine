# Travelport Stays constructor authority

## Purpose

The public Travelport Rules and reservation-authority adapters are long-lived provider objects. Their constructor inputs include credentials, tenant/credential-version cache identity, provider dependencies, transport, timeout, and clock authority. TypeScript `Readonly` types do not make caller-owned runtime objects immutable, so validating or wrapping one field and then forwarding the original constructor object can create a time-of-check/time-of-use gap before any request method runs.

This boundary fixes the connected Rules → reservation-authority constructor chain without changing provider capabilities.

## Materialization contract

`TravelportStaysBookingTermsProvider` and `TravelportStaysReservationAuthorityProvider` now materialize constructor authority before handing anything to their compatibility cores.

The materializer:

- reads each declared top-level constructor field exactly once;
- copies the six Travelport credential fields into a new frozen credential snapshot;
- keeps provider dependencies, transport, timeout, and clock as one-read capability/value references;
- returns a frozen allowlisted constructor snapshot; and
- converts throwing accessors and revoked proxies into a fixed `INVALID_REQUEST` supplier error without propagating caller-controlled exception text.

The wrappers no longer spread the original caller-owned constructor object into `super(...)`. The cache key validated by the reservation-authority wrapper is the exact cache key forwarded to the compatibility core, so a getter cannot return one value for validation and another value for OAuth token-cache partitioning.

## Scope and similar-issue review

This is the constructor-level continuation of the existing Travelport input materialization work. Request-level search, pricing, Rules, and reservation-authority inputs already use frozen snapshots, while Create and Booking.com Sync execution inputs are separately materialized before their asynchronous write boundaries.

The production integration loader already supplies frozen normalized credentials and a primitive cache key derived from the persisted integration id plus credential version. That remains the primary server path. The constructor boundary is still enforced independently so direct adapter use, tests, and future composition cannot weaken the same authority assumptions.

The wider Travelport provider/executor family also stores already-normalized credentials supplied by the integration loader. This run does not introduce a speculative common constructor abstraction across unrelated write/recovery executors; their request/write authority and retry semantics remain separate reviewed boundaries.

## Activation boundary

This hardening does not enable the Travelport `reservation` capability. Activation still requires the concrete reviewed PCI-safe FormOfPayment/guarantee source, live non-production end-to-end validation, and authoritative live `13034` / locator-less recovery semantics.

Related documentation:

- `docs/travelport-stays-input-materialization-authority.md`
- `docs/travelport-reservation-prewrite-authority.md`
- `docs/travelport-reservation-authority-machine-evidence.md`
