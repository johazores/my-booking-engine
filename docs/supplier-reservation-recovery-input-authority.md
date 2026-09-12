# Supplier reservation recovery input authority

## Purpose

The provider-neutral supplier reservation recovery layer crosses durable commercial state, provider-request replay protection, and provider-specific recovery evidence. Those services accept JavaScript objects from higher-level server coordinators, so a caller-owned getter, proxy, nested outcome object, or later mutation must not be able to change tenant identity or recovery authority after validation has started.

SF therefore materializes the current recovery-state inputs into small frozen allowlisted snapshots before authorization, database locks, durable attempt transitions, evidence persistence, or settlement decisions.

## Covered recovery-state boundaries

`hospitality-supplier-reservation-recovery-input-authority.ts` provides one provider-neutral materialization boundary for the connected recovery workflow:

- provider-request marker input, including the fresh-request replay guard;
- stale in-flight attempt recovery scope;
- post-marker supplier-confirmation/provider-recovery evidence staging;
- locator-less recovery-write claim authority, including the reservation-payload fingerprint; and
- recovery-write settlement, including a branch-specific frozen outcome.

Each authoritative property is read once. Arrays, revoked proxies, throwing getters, malformed required primitive fields, unsupported settlement states, and non-boolean retry flags fail through one fixed `HospitalitySupplierReservationConflictError`. Caller-controlled exception messages are never rethrown.

Settlement materialization is branch-specific. A `CONFIRMED` result reads only confirmation authority, a `FAILED` result reads only failure/retry authority, and an `AMBIGUOUS` result reads only ambiguous failure/correlation authority. Irrelevant properties cannot become accidental execution inputs.

## Security and tenant authority

Materialization is not authorization. The existing services still validate UUID identifiers, require server-side `booking:manage`, scope every operation to the exact organization, use organization-scoped advisory locks, revalidate durable attempt state, and enforce active integration/provider/credential/capability authority at the provider-request boundary.

The materializer only ensures that those checks and the later write use the same stable values instead of repeatedly consulting mutable runtime objects.

## Similar-issue scope

This change follows the same runtime-authority rule already applied to known-locator reconciliation. The same defect pattern existed in the immediately connected recovery-state services, so provider marking, stale recovery, staged recovery evidence, recovery-write claim, and recovery-write settlement are hardened together.

The broader supplier reservation service and unrelated booking/payment modules are not rewritten by this change. Provider-specific Travelport request/response behavior remains behind its existing adapter and coordinator boundaries.

## Privacy and activation boundary

The snapshots contain only identifiers, bounded non-secret recovery authority already accepted by the existing domain validators, replay-policy booleans, and normalized settlement inputs. They add no provider payloads, credentials, bearer tokens, traveler/customer PII, PAN/CVV, request bodies, or response bodies to persistence, logs, audits, or fingerprints.

Travelport `reservation` remains deliberately disabled. This hardening does not provide the concrete reviewed PCI-safe FormOfPayment/guarantee source, live non-production reservation validation, or authoritative live `13034` / locator-less correlation and retry semantics required for activation.

Related documentation:

- `docs/supplier-reservation-operations.md`
- `docs/supplier-reservation-reconciliation-authority.md`
- `docs/travelport-stays-integration.md`
