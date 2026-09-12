# Travelport Stays constructor authority

## Purpose

The public Travelport pricing, Rules, and reservation-authority adapters are long-lived provider objects. Their constructor inputs include credentials, tenant/credential-version cache identity, provider dependencies, transport, timeout, and clock authority. TypeScript `Readonly` types do not make caller-owned runtime objects immutable, so validating or wrapping one field and then forwarding the original constructor object can create a time-of-check/time-of-use gap before any request method runs.

This boundary fixes the connected pricing → Rules → reservation-authority constructor chain without changing provider capabilities.

## Materialization contract

`TravelportStaysProvider`, `TravelportStaysBookingTermsProvider`, and `TravelportStaysReservationAuthorityProvider` materialize constructor authority before handing anything to their compatibility cores.

The materializer:

- reads each declared top-level constructor field exactly once;
- copies the six Travelport credential fields into a new frozen credential snapshot;
- keeps provider dependencies, transport, timeout, and clock as one-read capability/value references;
- returns a frozen allowlisted constructor snapshot; and
- converts throwing accessors and revoked proxies into a fixed `INVALID_REQUEST` supplier error without propagating caller-controlled exception text.

The wrappers no longer spread original caller-owned constructor objects into `super(...)`. Cache keys validated by the compatibility cores therefore come from the same stable snapshot used for OAuth token-cache partitioning, and later mutation of caller-owned credential objects cannot change long-lived OAuth or request-header authority.

## Scope and similar-issue review

This is the constructor-level continuation of the existing Travelport input materialization work. Request-level search, pricing, Rules, and reservation-authority inputs already use frozen snapshots, while Create and Booking.com Sync execution inputs are separately materialized before their asynchronous write boundaries.

The same-scope sweep also covered the public configuration/authentication entry functions. Configuration normalization, stored credential reads, direct access-token requests, and health probes now establish their own one-read entry snapshots before validation or provider I/O. That boundary is documented in `docs/travelport-stays-entry-authority.md`.

The production integration loader already supplies frozen normalized credentials and a primitive cache key derived from the persisted integration id plus credential version. That remains the primary server path. The public adapter boundaries are still enforced independently so direct adapter use, tests, and future composition cannot weaken the same authority assumptions.

The separate Create, Sync, and recovery executors keep their reviewed write/retry materialization contracts. This work does not merge those distinct outcome and recovery semantics into a speculative common abstraction.

## Activation boundary

This hardening does not enable the Travelport `reservation` capability. Activation still requires the concrete reviewed PCI-safe FormOfPayment/guarantee source, live non-production end-to-end validation, and authoritative live `13034` / locator-less recovery semantics.

Related documentation:

- `docs/travelport-stays-entry-authority.md`
- `docs/travelport-stays-input-materialization-authority.md`
- `docs/travelport-reservation-prewrite-authority.md`
- `docs/travelport-reservation-authority-machine-evidence.md`
