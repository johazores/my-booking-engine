# Travelport Stays commercial penalty authority

## Purpose

Travelport Rules cancellation penalties become provider-neutral booking-term authority and participate in durable terms review. SF therefore validates the provider's documented penalty variant before the compatibility parser can normalize it.

This hardening does not enable the Travelport `reservation` capability.

## Rules penalty variants

The current Travelport Hotel Rules contract documents exactly three `HotelPenalty` variants:

- `HotelPenaltyAmount`: one exact currency amount.
- `HotelPenaltyPercent`: a percentage of the total amount; when `appliesTo` is returned it is `Amount`.
- `HotelPenaltyNights`: a number of nights, with optional `subjectToTax` of `Yes`, `No`, or `Unknown`.

SF now fails closed when:

- `@type` is unsupported or missing;
- the selected variant is missing its required value;
- mutually exclusive fields from another penalty variant are also present;
- a percent penalty returns an unsupported `appliesTo` value; or
- a nights penalty returns an unsupported tax-treatment value.

This prevents contradictory provider data from gaining authority simply because the compatibility parser selects one branch and ignores the conflicting fields.

## Numeric authority

SearchComplete and Rules money values, plus Rules percent/night decimal values, must now use plain non-negative decimal syntax before compatibility parsing. Scientific notation, currency-decorated strings, signs, separators, non-finite values, and other normalization-dependent forms are rejected.

This applies through the existing shared commercial boundary to SearchComplete base/tax/total/fee values, SearchComplete cancellation amounts, Rules offer prices, amount penalties, and deposit amounts.

Currency-specific minor-unit validation still happens in the existing pricing compatibility boundary. This layer only ensures the provider scalar has an unambiguous decimal representation before that conversion.

## Similar-issue sweep

The sweep covered all money and cancellation-penalty evidence already traversed by `travelport-stays-commercial-authority.ts`. The three Rules penalty branches share one validator, so unsupported or contradictory evidence cannot bypass the guard through a sibling penalty type. SearchComplete and Rules money paths share `exactMoneyIfPresent`, so the same lexical rule applies consistently.

Rules guarantee handling remains intentionally unchanged: an unrecognized guarantee is normalized to provider-neutral `UNKNOWN` and makes reservation review incomplete rather than granting booking authority.

## Validation

Focused behavior coverage verifies:

- canonical amount, percent, and nights penalties;
- unsupported, incomplete, and contradictory penalty variants;
- `appliesTo` and `subjectToTax` authority;
- malformed money strings across SearchComplete and Rules; and
- exponent-form numeric/decimal evidence.

A dependency-free source contract pins the production guard. Full repository Node 24.20+/TypeScript 6 validation, Prisma/PostgreSQL execution, production build, and live Travelport verification still require environments unavailable to the current runner.

## Activation boundary

Travelport `reservation` remains deliberately unadvertised pending:

1. a concrete reviewed PCI-safe FormOfPayment/guarantee source;
2. live non-production SearchComplete → Rules → Availability → initial Create → reviewed Create → Sync/recovery verification; and
3. authoritative live `13034` and locator-less correlation/retry semantics.

## Travelport references

- Hotel Rules Reference Payload API Reference: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_RulesRefPayload.htm
- SearchComplete API Reference: https://support.travelport.com/webhelp/JSONAPIs/Hotelv11/Content/Hotel11/APIReferences/APIRef_SearchComplete.htm

## Related SF contracts

- `docs/travelport-stays-commercial-scalar-authority.md`
- `docs/travelport-stays-commercial-authority.md`
- `docs/travelport-stays-reference-authority.md`
