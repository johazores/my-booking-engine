# Supplier reservation machine-token authority

## Purpose

The provider-neutral supplier reservation ledger is a commercial idempotency and recovery boundary. Supplier property/offer identifiers, provider locators, supplier confirmations, recovery references, and provider correlation values are machine evidence. SF must preserve them exactly rather than silently turning padded, control-bearing, or ill-formed input into a different accepted value.

This contract is provider-neutral. Provider-specific meaning still belongs behind adapters, and this hardening does not enable any disabled integration capability.

## Exact token rule

`isExactHospitalitySupplierMachineToken` is the shared bounded token guard for reservation evidence. Accepted values must:

- be strings with at least one character;
- remain within the caller's persistence/provider limit;
- be a well-formed Unicode scalar-value sequence, with no lone UTF-16 surrogate code units;
- already have canonical outer whitespace, so `trim()` would not change them; and
- contain no ASCII control character from `U+0000` through `U+001F` or `U+007F`.

Internal spaces are not rejected by the provider-neutral guard because individual providers may legitimately define opaque values containing them. Valid well-formed non-BMP Unicode also remains allowed when a provider-specific contract permits it. Provider adapters can impose narrower syntax where their contract permits it.

Well-formed Unicode is an exactness requirement rather than normalization. JavaScript can hold a lone surrogate and `JSON.stringify` can emit it as an escape, while UTF-8 transport or persistence layers can reject or replace the same code unit. SF therefore rejects that value before it can be hashed, compared, encoded, or persisted as commercial machine authority instead of accepting a runtime-dependent replacement.

The guard protects the immutable supplier property/offer references included in the reservation request fingerprint, provider reservation locators, supplier confirmation references, provider correlation IDs, ephemeral submission references, and durable recovery authority. Recovery confirmation comparison also refuses malformed recovered confirmation evidence before it can satisfy a missing-confirmation requirement. Because these callers share one guard, the Unicode invariant applies at the same provider-neutral boundaries without duplicating provider-specific normalization logic. Reservation payment-authority derivation now uses the same guard for accepted supplier card codes instead of maintaining a parallel trim/control implementation.

## Idempotency

Reservation idempotency keys are already restricted to the explicit `[A-Za-z0-9._:-]` alphabet. The preparation boundary applies that pattern to the original value instead of trimming first. A padded key is therefore invalid rather than an alias for another operation's key.

The same principle applies to supplier property and offer references. Because those values participate in `requestFingerprint`, SF must not collapse two caller/provider spellings before hashing them.

Normalized failure codes are intentionally different. They are SF-owned categorical labels, not provider identifiers, so their existing normalization remains unchanged.

## Persistence backstop

The PostgreSQL migration adds defense-in-depth checks for immutable property/offer references and for operation/attempt provider evidence. It rejects ASCII control characters in provider reservation references, supplier confirmations, recovery references, and correlation IDs. Property/offer references additionally remain non-empty and outer-space canonical at the database boundary.

PostgreSQL stores text as valid database-encoding characters, so a JavaScript lone surrogate is not a durable representation that the database constraint should normalize on SF's behalf. The application guard rejects ill-formed UTF-16 before the database driver can reject or replacement-normalize it; the existing SQL constraints remain the durable backstop for canonical whitespace and control-character invariants that PostgreSQL can represent directly.

The migration does not rewrite unsafe historical evidence. If an existing row violates the existing database invariant, deployment must stop for explicit investigation rather than silently changing commercial identity.

## Authorization and privacy

No tenant or authorization behavior is weakened. Supplier reservation services still require server-side `booking:manage`, repeat organization scope on reads/writes, bind the exact tenant integration/credential version, and use operation-scoped locks around state transitions.

The hardening adds no provider payloads, traveler data, payment-card data, credentials, tokens, locators, confirmations, or recovery references to audit/log output.

## Validation

Focused executable tests cover exact token acceptance, valid non-BMP Unicode, lone high/low surrogate rejection, padding/control rejection, accepted supplier card-code evidence, exact idempotency keys, immutable selection references, provider locator/confirmation/correlation normalization boundaries, and recovery confirmation matching. A dependency-free source contract pins shared-guard adoption, the well-formed-Unicode invariant, and the PostgreSQL constraint coverage.

Full repository validation still requires the repository-supported Node 24 / TypeScript 6 dependency environment. PostgreSQL migration execution and constraint verification require an explicitly disposable database target.

## Activation boundary

This change strengthens the existing supplier reservation infrastructure only. Travelport `reservation` remains deliberately disabled pending the reviewed PCI-safe FormOfPayment/guarantee source, live non-production end-to-end verification, and authoritative live `13034` / locator-less recovery semantics.

Related contracts:

- `docs/supplier-reservation-operations.md`
- `docs/supplier-reservation-submission-authority.md`
- `docs/travelport-reservation-commercial-machine-token-authority.md`
- `docs/travelport-reservation-unicode-authority.md`
- `docs/travelport-stays-integration.md`
