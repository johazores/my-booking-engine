# Supplier Provider Failure Authority

## Purpose

Supplier failures can influence durable retry, reconciliation, and recovery decisions. A caught JavaScript value is not trustworthy authority by itself: provider adapters, delegated capabilities, tests, or future integrations can throw mutable objects, custom errors, or hostile proxies. SF therefore treats the supplier failure code as the only machine authority that may cross these boundaries and derives retryability from the repository-owned code policy.

This contract applies to provider transport normalization, reservation pre-provider settlement, known-locator reservation reconciliation, and the deferred Travelport payment-card source boundary.

## Canonical failure snapshot

`inspectHospitalitySupplierProviderFailure` accepts only a real `HospitalitySupplierProviderError` whose `code` is still one of the repository-owned `hospitalitySupplierFailureCodes`.

When the value is accepted, SF snapshots only:

- the canonical failure code; and
- retryability derived from that canonical failure code.

Retryability is derived from the canonical failure code rather than copied from the mutable runtime `error.retryable` property. `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, and `TIMEOUT` remain retryable. Authentication, invalid-request, and invalid-response failures remain non-retryable.

If `instanceof`, `code` access, or another inspection step throws because the caught value is a hostile or revoked proxy, inspection returns no provider authority. A mutated error whose code is no longer allowlisted is handled the same way. This prevents a secondary exception from interrupting settlement of a commercial operation.

## Boundary behavior

Shared supplier transport keeps the caller-owned timeout authoritative. Otherwise it snapshots a recognized supplier failure and rematerializes a new `HospitalitySupplierProviderError` from the canonical code. Raw provider or source error messages are not propagated through that transport normalization boundary. Unknown, mutated, or hostile transport failures become `PROVIDER_UNAVAILABLE`.

Before a reservation provider-request marker exists, a recognized supplier failure can settle through the provider-neutral pre-provider classifier. Unknown or hostile values settle as fixed `PRE_PROVIDER_EXECUTION_FAILED` with `retryable=false`; they cannot invent automatic retry authority.

Known-locator reconciliation uses the same snapshot. Before the durable provider-request marker, an untyped failure maps to `INVALID_REQUEST`. After the marker, it maps to `PROVIDER_UNAVAILABLE`, preserving the existing conservative distinction while preventing hostile thrown values from escaping the reconciliation settlement path.

The Travelport deferred payment-card source also uses the shared snapshot. It may preserve only an allowlisted provider failure code, then throws a new SF-owned error with the fixed payment-source failure message. Payment-card material and source-specific diagnostics are never included in durable failure authority.

## Security and privacy

This boundary does not persist thrown objects, stacks, provider messages, source messages, request or response payloads, credentials, tokens, traveler data, or payment-card data. It narrows failures to fixed SF-owned machine codes and repository-owned retry semantics.

The helper is deliberately fail closed. Plain objects that merely resemble provider errors do not gain authority, mutated codes do not gain authority, and hostile proxy behavior cannot convert an unknown failure into a retryable one.

## Activation boundary

This hardening does not enable the Travelport `reservation` capability, add a public reservation write route, or claim live-provider validation. Travelport reservation activation still requires the separately reviewed PCI-safe FormOfPayment/guarantee source, live non-production end-to-end verification, and the remaining provider recovery evidence gates tracked in GitHub issue #1.

## Validation

Focused unit coverage verifies canonical retryability, mutable `retryable` resistance, mutated code rejection, revoked-proxy fail-closed behavior, timeout priority, transport message sanitization, and unknown transport normalization.

A dependency-free source contract protects the same authority rule across pre-provider settlement, transport normalization, reconciliation, and the Travelport payment-card source. Full Node 24.20+/TypeScript 6 validation, Prisma/PostgreSQL checks, and production build remain separate repository validation gates when the required runtime and database are available.

## Related documents

- `docs/supplier-reservation-operations.md`
- `docs/supplier-reservation-attempt-recovery.md`
- `docs/supplier-provider-observability.md`
- `docs/travelport-reservation-payment-card-boundary.md`
- `docs/travelport-reservation-create-coordinator.md`
