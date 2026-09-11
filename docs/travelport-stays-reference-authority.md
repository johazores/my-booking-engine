# Travelport Stays supplier-reference authority

## Purpose

SF carries Travelport hotel property and offer selections from SearchComplete into pricing revalidation, Rules review, and the disabled reservation path as opaque supplier references. Those references encode provider-owned chain, property, and rate identifiers. They are machine evidence, not presentation text, so SF must not silently normalize a differently spelled value into the same commercial identity.

This contract applies before Travelport reservation activation. It does not advertise the `reservation` capability or relax any Phase 15 gate.

## Public authority boundary

The public `travelport-stays-provider.ts` and `travelport-stays-booking-terms-provider.ts` modules are now narrow authority adapters. The previous implementations are preserved behind kebab-case `*-core.ts` compatibility modules so existing provider behavior stays stable while every existing import continues through the hardened public boundary.

The compatibility modules are implementation details. Production code, tests, reservation services, and future integrations should keep importing the public provider modules rather than bypassing the authority adapters.

## Canonical supplier references

Both the SearchComplete/pricing provider and the Rules booking-terms provider require supplier property and offer references to use canonical base64url spelling.

A reference must:

- be non-empty and within the existing 4,096-character bound;
- contain only the base64url alphabet used by SF;
- decode successfully as JSON; and
- round-trip through Node base64url decoding and encoding without changing its spelling.

The round-trip check rejects alternate base64url spellings that decode to the same bytes.

Decoded Travelport property identity is exact. `chainCode` and `propertyCode` must already satisfy their alphanumeric provider identifier contracts. Decoded offer `rateValue` is also exact: leading/trailing whitespace and ASCII controls `U+0000` through `U+001F` plus `U+007F` fail closed.

## Provider response authority

Successful Travelport hotel responses are inspected before the compatibility core can normalize them. SearchComplete provider responses are hardened at the point where SF creates or replays supplier authority:

- chain and property codes must be exact bounded machine values;
- rate-key values must be exact bounded machine values;
- the booking code and Rules bridge rate code, rate plan ID, and rate category must be exact;
- pagination tokens reject the full ASCII control range before SF stores or replays them; and
- provider currency codes used by Rules authority must already use canonical uppercase three-letter form.

Human-readable hotel names, descriptions, and other presentation text retain their existing text-normalization behavior. Credential normalization is also outside this contract.

## Rules authority

Rules preflight consumes the same exact supplier property and offer references before provider I/O. The response authority guard also rejects padded/control-bearing accepted payment-card codes before they can become reservation capability evidence. Property, booking, and card machine values therefore cannot become trusted merely because the underlying compatibility implementation would have trimmed them.

The final Rules flow still performs its existing fresh offer revalidation. This change strengthens evidence spelling; it does not bypass price, offer-fingerprint, cancellation, guarantee, or payment review requirements.

## End-to-end effect

The same property/offer identity is now exact across:

1. SearchComplete property discovery;
2. SearchComplete offer pricing;
3. pagination replay;
4. offer revalidation;
5. Rules bridge construction and review; and
6. the already-hardened reservation expectation used by initial Create, reviewed Create, Booking.com Sync, and known-locator recovery.

This closes the upstream normalization inconsistency without moving tenant authorization into provider adapters. Tenant, integration, permission, and durable reservation ownership remain enforced by the provider-neutral server-side services.

## Validation

Focused executable coverage verifies:

- non-canonical base64url aliases fail before provider I/O;
- decoded padded property and offer-rate identity fails before provider I/O;
- provider property and rate identity that only becomes valid after trimming is rejected;
- ASCII-control-bearing rate and pagination tokens are rejected;
- Rules bridge booking codes cannot gain authority through trimming; and
- padded accepted-card evidence is rejected before Rules review can complete.

A dependency-free source contract pins the public authority adapters, response guard, exact machine-token coverage, and isolation of the compatibility modules.

Available local validation uses Node type stripping and dependency-free contract execution. Full repository validation still requires the repository-supported Node 24.20+ / TypeScript 6 dependency environment. Live verification still requires provisioned Travelport non-production credentials.

## Activation boundary

Travelport `reservation` remains deliberately unadvertised. The existing activation gates remain:

1. provision and review a concrete PCI-safe FormOfPayment/guarantee source;
2. complete live non-production SearchComplete → Rules → Availability → initial Create → reviewed Create → Sync/recovery verification; and
3. establish authoritative live handling for `13034` and locator-less recovery semantics.

Related contracts:

- `docs/travelport-reservation-property-reference-authority.md`
- `docs/travelport-reservation-commercial-machine-token-authority.md`
- `docs/travelport-reservation-create-coordinator.md`
- `docs/travelport-stays-integration.md`
