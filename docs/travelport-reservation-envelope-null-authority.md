# Travelport reservation envelope null authority

## Purpose

Travelport Stays Create Reservation, Booking.com Sync, and known-locator Retrieve all consume provider-owned reservation-response structures that can influence durable booking state. SF distinguishes a field that Travelport genuinely omitted from a field that is explicitly present as JSON `null` whenever that field identifies the response family, embedded provider result evidence, or the narrow passive-placeholder shape.

This is a provider-response interpretation rule only. It does not enable the Travelport `reservation` capability, expose a supplier-write route, change tenant authorization, or create retry authority.

## Provider boundary

Current Travelport reservation documentation returns concrete response objects such as `ReservationResponse`, `Reservation`, `Offer`, `Receipt`, and, when provider messages are returned, a concrete `Result` object containing warning or error evidence. The current response examples use omission for fields that are not present; SF does not rely on an undocumented `null` value as equivalent evidence of omission.

For commercial Create and Booking.com Sync classification:

- top-level `ReservationResponse` and `ErrorResponse` presence is determined by whether the property exists, not whether its value is non-null;
- exactly one top-level response family may be present and it must be a structured object matching the HTTP outcome class;
- an explicit `null` sibling therefore remains competing/malformed response evidence and cannot disappear beside a confirmation-looking reservation or a review/retry-looking error;
- `ReservationResponse.Result` may be genuinely omitted, but if present it must be a structured object;
- `Result.Error` and defensive `Result.Errors` are treated as embedded error evidence whenever present, including explicit `null` values; and
- `Result.Warning` / defensive `Result.Warnings` are optional by omission, but a present value must be the supported bounded array shape. Explicit `null` is malformed rather than an empty warning set.

The known-locator Retrieve parser applies the same absent-not-null rules before it can normalize provider reservation authority. `ErrorResponse: null` cannot be ignored beside `ReservationResponse`, and present `Result`/error/warning fields must be structurally valid.

## Passive placeholder compatibility

Known-locator Retrieve has one narrow Travelport-specific allowance for the documented passive placeholder receipt associated with a passive hotel offer. That placeholder has no locator. SF now requires `Confirmation.Locator` to be genuinely absent for this exception. `Locator: null` does not prove the documented placeholder shape; it falls through to normal receipt validation and fails closed.

This does not change the broader active/passive segment contract. Only the exact documented placeholder can be discarded after offer ownership is proven, while malformed Stays evidence cannot disappear merely because it points to a passive offer.

## Failure semantics

Commercial malformed envelope/result evidence becomes `AMBIGUOUS / INVALID_RESPONSE`. It cannot become:

- `CONFIRMED`;
- a price/guarantee `REVIEW_REQUIRED` decision;
- a definitive retryable or non-retryable no-sell result;
- Booking.com Sync recovery authority; or
- a durable provider locator.

Known-locator malformed evidence throws provider `INVALID_RESPONSE` and therefore cannot become provider-neutral `FOUND` or authorize another sell.

These fail-closed outcomes are intentional because Create and Sync are commercial writes and because known-locator recovery can settle an earlier ambiguous write.

## Validation

Focused regression coverage verifies:

- genuine omission of the unused top-level sibling and `Result` still permits otherwise complete reservation authority;
- `ErrorResponse: null` cannot disappear beside a valid success response;
- `ReservationResponse: null` cannot disappear beside a price-change error that would otherwise produce review authority;
- explicit-null `Result`, `Result.Error`, `Result.Errors`, `Result.Warning`, and `Result.Warnings` are rejected consistently by commercial Create/Sync classification and known-locator Retrieve;
- conflicting warning families still fail closed; and
- a passive placeholder is accepted only when `Confirmation.Locator` is genuinely omitted, while explicit `Locator: null` is rejected.

A dependency-free source contract locks the response-family and Result presence semantics so future refactoring does not accidentally restore null-as-omission behavior.

Full repository validation still requires the repository-supported Node 24 / TypeScript 6 dependency environment. Live provider behavior remains gated on provisioned Travelport non-production credentials and the reviewed PCI-safe payment/guarantee source. GitHub Actions are not used.

## Related documentation

- `docs/travelport-reservation-response-evidence.md`
- `docs/travelport-stays-create-outcome-classification.md`
- `docs/travelport-create-error-authority.md`
- `docs/travelport-known-locator-reservation-type.md`
- `docs/travelport-reservation-passive-receipt-scope.md`
