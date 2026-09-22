# Supplier Provider Failure Authority

## Purpose

Supplier failures can influence durable retry, reconciliation, and recovery decisions. A caught JavaScript value is not trustworthy authority by itself: provider adapters, delegated capabilities, tests, or future integrations can throw mutable objects, custom errors, prototype-spoofed lookalikes, or hostile proxies. SF therefore treats only constructor-registered supplier failures as machine authority and derives retryability from the repository-owned failure-code policy.

This contract applies to provider transport normalization, reservation pre-provider settlement, known-locator reservation reconciliation, and the deferred Travelport payment-card source boundary.

## Canonical failure snapshot

`HospitalitySupplierProviderError` registers its original failure code in a module-private `WeakMap` when SF constructs the error. `inspectHospitalitySupplierProviderFailure` accepts authority only when all of the following remain true:

- the value is still an actual `HospitalitySupplierProviderError` instance;
- the value exists in the private constructor authority registry;
- the registered code is one of the repository-owned `hospitalitySupplierFailureCodes`; and
- the public `error.code` still matches the constructor-registered code.

The private registry matters because JavaScript `instanceof` is not proof of construction. `Object.create(HospitalitySupplierProviderError.prototype)` can produce a prototype lookalike that passes `instanceof`; that object has no SF constructor registration and therefore receives no provider-failure authority.

When a value is accepted, SF snapshots only:

- the constructor-registered canonical failure code; and
- retryability derived from that canonical failure code.

Retryability is derived from the canonical failure code rather than copied from the mutable runtime `error.retryable` property. `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, and `TIMEOUT` remain retryable. Authentication, invalid-request, and invalid-response failures remain non-retryable.

If `instanceof`, public `code` access, or another inspection step throws because the caught value is a hostile or revoked proxy, inspection returns no provider authority. A registered error whose public code was mutated also loses authority instead of silently changing durable failure semantics.

## Boundary behavior

Shared supplier transport keeps the caller-owned timeout authoritative. Otherwise it snapshots a recognized supplier failure and rematerializes a new `HospitalitySupplierProviderError` from the canonical code. Raw provider or source error messages are not propagated through that transport normalization boundary. Unknown, forged, mutated, or hostile transport failures become `PROVIDER_UNAVAILABLE`.

Before a reservation provider-request marker exists, a recognized supplier failure can settle through the provider-neutral pre-provider classifier. Unknown, forged, or hostile values settle as fixed `PRE_PROVIDER_EXECUTION_FAILED` with `retryable=false`; they cannot invent automatic retry authority.

Known-locator reconciliation uses the same snapshot. Before the durable provider-request marker, an untyped failure maps to `INVALID_REQUEST`. After the marker, it maps to `PROVIDER_UNAVAILABLE`, preserving the existing conservative distinction while preventing hostile thrown values from escaping the reconciliation settlement path.

The Travelport deferred payment-card source also uses the shared snapshot. It may preserve only an accepted provider failure code, then throws a new SF-owned error with the fixed payment-source failure message. Payment-card material and source-specific diagnostics are never included in durable failure authority.

## Similar-pattern boundary

The same-scope sweep distinguishes failure-authority decisions from parser-local exception preservation. Some Travelport parsers use `instanceof HospitalitySupplierProviderError` only to rethrow an SF error they raised inside the same synchronous parser while converting `JSON.parse` or encoding exceptions into a fixed request error. Those catches do not read `retryable`, do not change the failure code, and do not authorize retry, reconciliation, or supplier writes, so they are not provider-failure authority boundaries.

Any catch that begins using supplier failures to decide durable retryability, reservation settlement, reconciliation, or another commercial write/recovery decision must use the centralized inspection contract rather than trusting mutable public error fields. Operational connection-health classification is separate from this durable commercial-authority contract.

## Security and privacy

This boundary does not persist thrown objects, stacks, provider messages, source messages, request or response payloads, credentials, tokens, traveler data, or payment-card data. It narrows failures to fixed SF-owned machine codes and repository-owned retry semantics.

The helper is deliberately fail closed. Plain objects that merely resemble provider errors, prototype-spoofed `instanceof` lookalikes, mutated codes, invalid runtime codes, and hostile proxy behavior cannot convert an unknown failure into a retryable one.

## Activation boundary

This hardening does not enable the Travelport `reservation` capability, add a public reservation write route, or claim live-provider validation. Travelport reservation activation still requires the separately reviewed PCI-safe FormOfPayment/guarantee source, live non-production end-to-end verification, and the remaining provider recovery evidence gates tracked in GitHub issue #1.

## Validation

Focused unit coverage verifies constructor registration, canonical retryability, mutable `retryable` resistance, prototype-spoof rejection, mutated-code rejection, invalid runtime-code rejection, revoked-proxy fail-closed behavior, timeout priority, transport message sanitization, and unknown transport normalization.

A dependency-free source contract protects the constructor-authority registry and the same failure snapshot rule across pre-provider settlement, transport normalization, reconciliation, and the Travelport payment-card source. Full Node 24.20+/TypeScript 6 validation, Prisma/PostgreSQL checks, and production build remain separate repository validation gates when the required runtime and database are available.

## Related documents

- `docs/supplier-reservation-operations.md`
- `docs/supplier-reservation-attempt-recovery.md`
- `docs/supplier-provider-observability.md`
- `docs/travelport-reservation-payment-card-boundary.md`
- `docs/travelport-reservation-create-coordinator.md`
