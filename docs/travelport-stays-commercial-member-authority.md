# Travelport Stays commercial member authority

## Purpose

Travelport Rules can return collection members whose primary value becomes part of SF commercial terms authority. A present collection member must not silently disappear during compatibility normalization, because accepted-card codes and formatted rule text contribute to the normalized booking terms and deterministic `termsFingerprint`.

This contract strengthens the existing read/review path only. It does not advertise Travelport `reservation`, add a booking action, collect payment-card data, or relax the existing provider activation gates.

## Provider contract

Current Travelport Stays Rules documentation describes `AcceptedCreditCard` as an array with a `value` containing the accepted two-character card code. The Travelport Create path already treats provider card codes as machine tokens, so SF applies the same provider-specific uppercase ASCII alphanumeric syntax across Rules evidence and Create request authority. It describes `TextBlock` as terms/information text and `TextFormatted.value` as the rule or information itself.

SF therefore distinguishes a truly absent optional collection from a malformed present member:

- absent or `null` `AcceptedCreditCard` remains compatible with no accepted-card evidence;
- each present accepted-card object must contain an exact two-character uppercase ASCII alphanumeric `value` matching `[A-Z0-9]{2}`;
- absent or `null` `TextBlock` remains compatible with no formatted-text evidence;
- each present text block must contain at least one `TextFormatted` member; and
- each present formatted-text member must contain non-empty retained text that fits the existing commercial text bound without control normalization or truncation.

Titles and language codes remain optional under the existing SF compatibility contract. The established commercial authority layer continues to validate those values when they are present.

## Why fail closed

The compatibility core intentionally normalizes historical provider variation. That means a missing accepted-card `value` is currently skipped, and an empty or missing formatted-text `value` is currently ignored. Without a pre-normalization authority check, malformed provider evidence could collapse into the same `termsFingerprint` as evidence that was genuinely absent.

`createTravelportStaysRulesMemberAuthorityFetch` composes outside the existing `createTravelportStaysReferenceAuthorityFetch`. Successful provider responses therefore cross the established structural/reference/commercial checks first, then this member-completeness check, before the compatibility core can normalize booking terms.

The wrapper is read-only. It clones successful JSON responses for validation and returns the original response unchanged. Non-success responses keep the existing provider failure path.

## Similar-issue sweep

The same Rules compatibility area was reviewed for other present members that could disappear:

- accepted-card machine syntax is now repeated at the successful Rules member boundary and again at Travelport Create material/executor boundaries, while the provider-neutral payment authority remains provider-syntax agnostic;
- guarantee objects with an unknown or missing `guaranteeType` normalize to `UNKNOWN` and make `completeForReservationReview=false`, so they already fail safe instead of disappearing;
- deposit and cancellation objects remain represented in normalized terms even when optional subfields are absent; and
- optional titles and language codes do not determine whether a formatted-text rule itself exists.

The high-confidence silent-drop defect is therefore limited to accepted-card codes and formatted-text primary values in this scope.

## Validation

Focused behavior coverage verifies canonical Rules members, optional collection absence, incomplete accepted-card members, lowercase/punctuation/non-ASCII accepted-card rejection, incomplete/empty text blocks, missing/empty/oversized formatted text, and successful unrelated JSON used by the composed fetch boundary.

Dependency-free source contracts pin the wrapper ordering, required member-value checks, exact two-character card-code machine syntax, and the continued absence of reservation/card-write behavior from this authority module.

Full repository validation still requires the repository-supported Node 24.20+ / TypeScript 6 dependency environment. Live provider verification still requires provisioned Travelport non-production credentials.

## Activation boundary

Travelport `reservation` remains deliberately unadvertised until the existing gates are complete:

1. a concrete reviewed PCI-safe FormOfPayment/guarantee source;
2. live non-production SearchComplete → Rules → Availability → initial Create → reviewed Create → Sync/recovery verification; and
3. authoritative live handling for `13034` and locator-less recovery semantics.

Related contracts:

- `docs/travelport-stays-commercial-authority.md`
- `docs/travelport-stays-commercial-scalar-authority.md`
- `docs/travelport-stays-commercial-penalty-authority.md`
- `docs/travelport-stays-create-request-material-authority.md`
- `docs/travelport-terms-fingerprint-authority.md`
- `docs/travelport-stays-integration.md`
