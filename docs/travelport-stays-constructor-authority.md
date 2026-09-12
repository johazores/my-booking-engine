# Travelport Stays constructor authority

## Purpose

Travelport pricing, Rules, reservation-authority, Create, Sync, and known-locator recovery objects are long-lived provider boundaries. Their constructor inputs include credentials, tenant/credential-version cache identity, provider dependencies, transport, timeout, and clock authority. TypeScript `Readonly` types do not make caller-owned runtime objects immutable, so validating one field and then retaining the original constructor object or credential reference can create a time-of-check/time-of-use gap before any request method runs.

This boundary fixes the connected pricing → Rules → reservation-authority → reservation I/O constructor chain without changing provider capabilities.

## Materialization contract

`TravelportStaysProvider`, `TravelportStaysBookingTermsProvider`, `TravelportStaysReservationAuthorityProvider`, `TravelportStaysReservationCreateExecutor`, `TravelportStaysReservationSyncExecutor`, and `TravelportStaysReservationRecoveryProvider` materialize constructor authority before handing it to a compatibility core or storing long-lived request state.

The materializer:

- reads each declared top-level constructor field exactly once;
- copies the six Travelport credential fields into a new frozen credential snapshot;
- keeps provider dependencies, transport, timeout, and clock as one-read capability/value references;
- returns a frozen allowlisted constructor snapshot; and
- converts throwing accessors and revoked proxies into a fixed `INVALID_REQUEST` supplier error without propagating caller-controlled exception text.

The pricing/Rules/reservation-authority wrappers no longer spread original caller-owned constructor objects into `super(...)`. The Create, Sync, and recovery boundaries likewise no longer retain caller-owned credential objects or reread constructor options after materialization. Cache keys are validated from the same stable snapshot used for OAuth token-cache partitioning, and later mutation of caller-owned credential objects cannot change long-lived OAuth or request-header authority.

## Scope and similar-issue review

This is the constructor-level continuation of the existing Travelport input and pre-write materialization work. Request-level search, pricing, Rules, and reservation-authority inputs already use frozen snapshots. Create and Booking.com Sync separately materialize their execution identity before their asynchronous write boundaries, and known-locator recovery normalizes its request identity before provider I/O. Constructor materialization is an independent earlier boundary: the provider object's credentials, cache identity, transport, timeout, and clock are stable before any request method is invoked.

The same-scope sweep searched the Travelport supplier code for direct long-lived `this.#credentials = input.credentials` storage. The remaining public reservation occurrences were Create, Booking.com Sync, and known-locator recovery; all three now use the shared reservation-I/O constructor snapshot. Direct assignments that remain inside the pricing, Rules, and reservation-authority compatibility cores receive already-materialized wrapper authority and are not public caller-owned boundaries.

The production integration loader already supplies frozen normalized credentials and a primitive cache key derived from the persisted integration id plus credential version. That remains the primary server path. Public adapter/executor boundaries are still enforced independently so direct use, tests, and future composition cannot weaken the same authority assumptions.

The same-scope review also covered the public configuration/authentication entry functions. Configuration normalization, stored credential reads, direct access-token requests, and health probes establish their own one-read entry snapshots before validation or provider I/O. That boundary is documented in `docs/travelport-stays-entry-authority.md`.

This change does not merge Create, Sync, recovery, or read/review outcome semantics into a speculative common abstraction. It shares only the identical constructor authority shape.

## Activation boundary

This hardening does not enable the Travelport `reservation` capability. Activation still requires the concrete reviewed PCI-safe FormOfPayment/guarantee source, live non-production end-to-end validation, and authoritative live `13034` / locator-less recovery semantics.

Related documentation:

- `docs/travelport-stays-entry-authority.md`
- `docs/travelport-stays-input-materialization-authority.md`
- `docs/travelport-reservation-prewrite-authority.md`
- `docs/travelport-reservation-authority-machine-evidence.md`
