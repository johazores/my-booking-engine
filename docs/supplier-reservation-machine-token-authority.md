# Supplier reservation machine-token authority

## Purpose

The provider-neutral supplier reservation ledger is a commercial idempotency and recovery boundary. Supplier property/offer identifiers, provider locators, supplier confirmations, recovery references, and provider correlation values are machine evidence. SF must preserve them exactly rather than silently turning padded or control-bearing input into a different accepted value.

This contract is provider-neutral. Provider-specific meaning still belongs behind adapters, and this hardening does not enable any disabled integration capability.

## Exact token rule

`isExactHospitalitySupplierMachineToken` is the shared bounded token guard for reservation evidence. Accepted values must:

- be strings with at least one character;
- remain within the caller's persistence/provider limit;
- already have canonical outer whitespace, so `trim()` would not change them; and
- contain no ASCII control character from `U+0000` through `U+001F` or `U+007F`.

Internal spaces are not rejected by the provider-neutral guard because individual providers may legitimately define opaque values containing them. Provider adapters can impose narrower syntax where their contract permits it.

The guard now protects the immutable supplier property/offer references included in the reservation request fingerprint, provider reservation locators, supplier confirmation references, provider correlation IDs, ephemeral submission references, and durable recovery authority. Recovery confirmation comparison also refuses malformed recovered confirmation evidence before it can satisfy a missing-confirmation requirement.

## Idempotency

Reservation idempotency keys are already restricted to the explicit `[A-Za-z0-9._:-]` alphabet. The preparation boundary now applies that pattern to the original value instead of trimming first. A padded key is therefore invalid rather than an alias for another operation's key.

The same principle applies to supplier property and offer references. Because those values participate in `requestFingerprint`, SF must not collapse two caller/provider spellings before hashing them.

Normalized failure codes are intentionally different. They are SF-owned categorical labels, not provider identifiers, so their existing normalization remains unchanged.

## Persistence backstop

The PostgreSQL migration adds defense-in-depth checks for immutable property/offer references and for operation/attempt provider evidence. It rejects ASCII control characters in provider reservation references, supplier confirmations, recovery references, and correlation IDs. Property/offer references additionally remain non-empty and outer-space canonical at the database boundary.

The migration does not rewrite unsafe historical evidence. If an existing row violates the new invariant, deployment must stop for explicit investigation rather than silently changing commercial identity.

## Authorization and privacy

No tenant or authorization behavior is weakened. Supplier reservation services still require server-side `booking:manage`, repeat organization scope on reads/writes, bind the exact tenant integration/credential version, and use operation-scoped locks around state transitions.

The hardening adds no provider payloads, traveler data, payment-card data, credentials, tokens, locators, confirmations, or recovery references to audit/log output.

## Validation

Focused executable tests cover exact token acceptance, padding/control rejection, exact idempotency keys, immutable selection references, provider locator/confirmation/correlation normalization boundaries, and recovery confirmation matching. A dependency-free source contract pins shared-guard adoption and the PostgreSQL constraint coverage.

Full repository validation still requires the repository-supported Node 24 / TypeScript 6 dependency environment. PostgreSQL migration execution and constraint verification require an explicitly disposable database target.

## Activation boundary

This change strengthens the existing supplier reservation infrastructure only. Travelport `reservation` remains deliberately disabled pending the reviewed PCI-safe FormOfPayment/guarantee source, live non-production end-to-end verification, and authoritative live `13034` / locator-less recovery semantics.

Related contracts:

- `docs/supplier-reservation-operations.md`
- `docs/supplier-reservation-submission-authority.md`
- `docs/travelport-reservation-commercial-machine-token-authority.md`
- `docs/travelport-stays-integration.md`
