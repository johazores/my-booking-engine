# Travelport Stays supplier-reference authority

## Purpose

SF carries Travelport hotel property and offer selections from SearchComplete into pricing revalidation, Rules review, and the disabled reservation path as opaque supplier references. Those references encode provider-owned chain, property, and rate identifiers. They are machine evidence, not presentation text, so SF must not silently normalize a differently spelled value into the same commercial identity.

This contract applies before Travelport reservation activation. It does not advertise the `reservation` capability or relax any Phase 15 gate.

## Public authority boundary

The public `travelport-stays-provider.ts` and `travelport-stays-booking-terms-provider.ts` modules are narrow authority adapters. Their previous implementations are preserved behind kebab-case `*-core.ts` compatibility modules so existing provider behavior stays stable while every existing import continues through the hardened public boundary.

The pre-write `travelport-stays-reservation-authority-provider.ts` now follows the same pattern. Its prior SearchComplete-to-Availability implementation is isolated behind `travelport-stays-reservation-authority-provider-core.ts`, while the public adapter owns canonical selected references and exact provider response evidence before compatibility parsing.

The compatibility modules are implementation details. Production code, tests, reservation services, and future integrations should keep importing the public provider modules rather than bypassing the authority adapters.

## Canonical supplier references

Both the SearchComplete/pricing provider and the Rules booking-terms provider require supplier property and offer references to use canonical base64url spelling. The reservation-authority adapter rechecks those same canonical references before its fresh SearchComplete and Availability calls.

A reference must:

- be non-empty and within the existing 4,096-character bound;
- contain only the base64url alphabet used by SF;
- decode successfully as JSON; and
- round-trip through Node base64url decoding and encoding without changing its spelling.

The round-trip check rejects alternate base64url spellings that decode to the same bytes.

Decoded Travelport property identity is exact. `chainCode` and `propertyCode` must already satisfy their alphanumeric provider identifier contracts. Decoded offer `rateValue` is also exact: leading/trailing whitespace and ASCII controls `U+0000` through `U+001F` plus `U+007F` fail closed.

## Provider response authority

Successful Travelport hotel responses are inspected before the compatibility cores can normalize them. SearchComplete provider responses are hardened at the point where SF creates or replays supplier authority:

- chain and property codes must be exact bounded machine values;
- rate-key values must be exact bounded machine values;
- the booking code and Rules bridge rate code, rate plan ID, and rate category must be exact;
- pagination tokens reject the full ASCII control range before SF stores or replays them;
- provider currency codes used by SearchComplete price/cancellation evidence and Rules authority must already use canonical uppercase three-letter form; and
- commercial money/text values that feed offer or Rules fingerprints are validated before compatibility normalization can trim, control-normalize, or truncate them.

Presentation-only hotel names and property descriptions retain their existing text-normalization behavior. Commercial descriptions/rule text that participate in normalized offer/terms authority are covered separately by `docs/travelport-stays-commercial-authority.md`. Credential normalization is outside this contract.

## Rules authority

Rules preflight consumes the same exact supplier property and offer references before provider I/O. The response authority guard rejects padded/control-bearing accepted payment-card codes and now also validates Rules money, decimals, payment/guarantee tokens, cancellation/deposit evidence, language codes, and bounded commercial rule text before they can become fingerprinted reservation-review authority.

The final Rules flow still performs its existing fresh offer revalidation. This change strengthens evidence spelling and preservation; it does not bypass price, offer-fingerprint, cancellation, guarantee, or payment review requirements.

See `docs/travelport-stays-commercial-authority.md`.

## Pre-write Availability authority

The reservation-authority provider performs its own fresh no-cache SearchComplete and v11 Availability requests immediately before reservation authority can become `READY`. Because that implementation directly consumes provider responses, it has an independent exact-evidence guard rather than relying on the display/pricing compatibility path.

Before the compatibility core sees a successful response, SF applies the existing SearchComplete/Availability collection ceilings and rejects normalization-confusable machine evidence across the selected SearchComplete rate and the Availability catalog. This includes booking/rate identifiers, canonical uppercase price currency, string money totals, Availability pagination and catalog-offering identifiers, provider submission references, property identity, booking code, and stay dates. All bounded machine strings reject leading/trailing whitespace and ASCII controls `U+0000` through `U+001F` plus `U+007F`.

The Availability `Identifier.value` is ephemeral and stays outside the stable authority fingerprint, but it can become the immediate provider submission reference used by Create. Its spelling therefore must be exact even though it is not durable commercial identity.

See `docs/travelport-reservation-authority-machine-evidence.md`.

## End-to-end effect

The same property/offer identity and provider authority policy is now exact/preservation-safe across:

1. SearchComplete property discovery;
2. SearchComplete offer pricing and fingerprint inputs;
3. pagination replay;
4. offer revalidation;
5. Rules bridge construction and commercial terms review;
6. fresh pre-write SearchComplete selection;
7. v11 Availability pagination and provider submission-reference selection; and
8. the already-hardened reservation expectation used by initial Create, reviewed Create, Booking.com Sync, and known-locator recovery.

This closes the upstream normalization inconsistency without moving tenant authorization into provider adapters. Tenant, integration, permission, and durable reservation ownership remain enforced by the provider-neutral server-side services.

## Validation

Focused executable coverage verifies:

- non-canonical base64url aliases fail before provider I/O;
- decoded padded property and offer-rate identity fails before provider I/O;
- provider property and rate identity that only becomes valid after trimming is rejected;
- padded SearchComplete price/cancellation currencies are rejected before money normalization;
- ASCII-control-bearing rate and pagination tokens are rejected;
- SearchComplete commercial money cannot gain authority through trimming/controls and fingerprinted commercial text cannot be silently truncated;
- Rules bridge booking codes cannot gain authority through trimming;
- padded accepted-card evidence is rejected before Rules review can complete;
- Rules price/cancellation/deposit money and decimal evidence cannot gain authority through trimming;
- Rules language/payment/guarantee machine tokens reject normalization-confusable spelling;
- Rules commercial text that would be control-normalized or truncated fails closed;
- optional deposit-policy traversal is bounded independently;
- pre-write SearchComplete booking/rate/currency/money authority cannot gain authority through trimming; and
- Availability pagination, catalog-offering, rate, property, booking, and stay-date evidence is exact before it can become sell authority.

Dependency-free source contracts pin the public authority adapters, response guards, commercial authority hooks, exact machine-token coverage, and isolation of the compatibility modules.

Available local validation uses Node type stripping and dependency-free contract execution. Full repository validation still requires the repository-supported Node 24.20+ / TypeScript 6 dependency environment. Live verification still requires provisioned Travelport non-production credentials.

## Activation boundary

Travelport `reservation` remains deliberately unadvertised. The existing activation gates remain:

1. provision and review a concrete PCI-safe FormOfPayment/guarantee source;
2. complete live non-production SearchComplete → Rules → Availability → initial Create → reviewed Create → Sync/recovery verification; and
3. establish authoritative live handling for `13034` and locator-less recovery semantics.

Related contracts:

- `docs/travelport-stays-commercial-authority.md`
- `docs/travelport-reservation-authority-machine-evidence.md`
- `docs/travelport-reservation-property-reference-authority.md`
- `docs/travelport-reservation-commercial-machine-token-authority.md`
- `docs/travelport-reservation-create-coordinator.md`
- `docs/travelport-stays-integration.md`
