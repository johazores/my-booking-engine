# Travelport Stays abort-signal authority

## Scope

Travelport supplier writes have a durable provider-request marker. A deterministic malformed or already-aborted Fetch signal must fail before transport I/O instead of being discovered by the native Fetch implementation after that marker. This is request validation, not evidence that the supplier did or did not receive a previously marked request.

## Implemented boundary

The shared environment-bound trace transport, terminal OAuth credential-containment transport, and reservation-only trace transport validate the effective request signal before delegation. A missing or null signal remains permitted. A genuine active native `AbortSignal` is forwarded unchanged so cancellation and the existing provider-owned timeout controller continue to work.

Validation uses the native `AbortSignal.prototype.aborted` accessor with the supplied signal as receiver. This rejects forged prototype-only objects, malformed signal values, and already-aborted signals without trusting a caller-defined `aborted` property or leaking getter exceptions. It does not turn an untrusted signal into timeout evidence.

The no-network reservation-write preflight uses both credentialed transport layers, so an invalid signal supplied to preflight is rejected before the durable marker. Current Create, reviewed Create, Sync, and known-locator recovery executors generate their actual timeout signals only for the later provider request. A timeout or cancellation after the marker remains conservatively subject to the existing ambiguous-write/reconciliation policy; this guard does not authorize a replay.

The operational logging wrapper remains observational and fail-open. Its diagnostic signal inspection is deliberately **not** changed into an authorization gate.

## Validation

Focused TypeScript tests cover native active and aborted signals, forged/hostile signal objects, the shared and terminal Stays transports, the reservation-only wrapper, and the no-I/O preflight. A dependency-free source contract pins the three fail-closed boundaries and the deliberately unchanged fail-open logger. Full Node 24, Prisma/PostgreSQL, and live Travelport validation remain separate gates. This change does not advertise the `reservation` capability or modify payment-card handling.

OAuth token exchanges and inherited `Request.signal` values use the same native-signal check. The tests also verify these cases reject before an injected terminal Fetch is invoked.
