# Travelport Stays public entry authority

## Purpose

The public Travelport configuration, authentication, health-probe, and pricing-provider entry points accept caller-owned JavaScript objects. Reading fields for validation and then forwarding the original object allows accessors, proxies, or mutable credential objects to present different authority to a later compatibility-core read or provider request.

This boundary materializes those inputs before semantic validation or provider I/O. It complements request-level search/Rules materialization and constructor authority without changing Travelport capabilities.

## Configuration authority

`normalizeTravelportStaysConfiguration` first copies only `environment`, `username`, `password`, `clientId`, `clientSecret`, and `accessGroup` into a frozen snapshot. Exact configuration validation and compatibility-core normalization both consume that snapshot. `readTravelportStaysCredentials` applies the same source snapshot before normalization, so a credential record accessor cannot change between individual field reads.

Throwing accessors and revoked proxies become a fixed `TravelportStaysConfigurationError`; caller-controlled exception text is not propagated.

## Authentication and health authority

Direct access-token requests and integration health probes copy the six credential fields into a new frozen snapshot and read transport/timeout/time authority once. The exact snapshot is then forwarded explicitly to the existing reference-authority transport wrapper and compatibility core. The original input is never spread into those calls.

Hostile accessors and revoked proxies fail closed as a fixed `INVALID_REQUEST` supplier error. This materialization does not broaden the credential schema or expose secrets to logs, audit events, or documentation.

## Pricing-provider constructor

The public `TravelportStaysProvider` constructor uses the shared constructor-authority materializer. Credentials, cache key, transport, timeout, and clock are copied/read once before `super(...)`, and the compatibility core receives only explicit materialized fields. Later caller mutation cannot change OAuth environment, request-header credentials, or token-cache identity.

## Similar-issue sweep

The same validation/forwarding pattern existed in four public entry surfaces in `travelport-stays-provider.ts`: configuration normalization, stored credential reads, direct access-token/health operations, and the long-lived pricing-provider constructor. All are now materialized. The connected Rules and reservation-authority constructors were already hardened through the same constructor-authority module.

The write-side Create, Sync, and recovery executors already use separate reviewed pre-write authority boundaries and retain their distinct ambiguity/retry contracts.

## Activation boundary

This change does not enable Travelport reservation capability or add a payment-card source. Reservation activation remains gated by the reviewed PCI-safe FormOfPayment/guarantee source, live non-production end-to-end verification, and authoritative live `13034` / locator-less recovery semantics.

Related documentation:

- `docs/travelport-stays-constructor-authority.md`
- `docs/travelport-stays-input-materialization-authority.md`
- `docs/travelport-reservation-prewrite-authority.md`
