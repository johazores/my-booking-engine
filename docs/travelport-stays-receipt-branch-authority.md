# Travelport Stays receipt branch authority

## Purpose

Travelport reservation `Receipt` entries are polymorphic provider evidence. Their outer `@type` identifies the payload family: `ReceiptConfirmation` carries a `Confirmation` branch, `ReceiptCancellation` carries a `Cancellation` branch in the shared reservation model, and `ReceiptPayment` represents payment/document evidence. SF must not let a commercial reservation branch disappear merely because the same object claims a different outer receipt type.

This is a provider-specific response-validation rule inside the shared Stays receipt inspector used by initial Create, reviewed Create, Booking.com Sync, and known-locator Retrieve. It does not enable the Travelport `reservation` capability.

## Provider evidence

Travelport's current shared Reservation Retrieve documentation defines `ReceiptConfirmation`, `ReceiptCancellation`, and `ReceiptPayment` as distinct receipt variants. It states that `ReceiptCancellation` contains `Cancellation` instead of `Confirmation`, while `ReceiptPayment` applies to payment. Current Hotel v11 Create, Retrieve, and Cancel examples return hotel locator evidence as `ReceiptConfirmation` with a `ConfirmationHold` branch; payment receipts in the shared reservation model use the separate payment/document shape.

## Fail-closed rule

The shared Stays inspector now treats the outer receipt discriminator and reservation branch as one structural authority boundary:

- a receipt cannot present both `Confirmation` and `Cancellation` branches;
- `ReceiptPayment` cannot carry either reservation branch;
- `ReceiptCancellation` cannot carry a sibling `Confirmation` branch; and
- `ReceiptConfirmation` cannot carry a sibling `Cancellation` branch.

Explicit `null` still counts as a present conflicting branch. This follows the existing absent-not-null policy for provider-owned evidence and prevents malformed JSON from converting a contradictory branch into omission.

Canonical unrelated `ReceiptPayment` objects remain outside Stays locator authority, including payment receipts scoped to another offer. Generic multi-content confirmation/cancellation compatibility otherwise remains unchanged. The existing locator-pair, receipt-token, offer-scope, status, cardinality, active/passive offer, and supplier identity checks continue to run after this branch boundary.

## Security and durability

This rule does not parse or persist payment data. It only prevents a typed receipt from hiding reservation identity or cancellation lifecycle evidence from the shared classifier. No PAN, CVV, form-of-payment data, provider body, or additional supplier secret becomes normalized or logged.

## Validation

Focused behavior coverage preserves canonical `ReceiptPayment` compatibility and rejects payment receipts containing reservation branches, mixed confirmation/cancellation objects, and explicit-null conflicting branches. A dependency-free source contract pins the branch-exclusivity checks. The existing shared receipt-evidence source contract separately confirms that Create/Sync and Retrieve continue to use the same inspector.

Full repository validation still requires the repository-supported Node 24 / TypeScript 6 dependency environment. PostgreSQL scenarios require an explicitly disposable target, and live Travelport verification requires provisioned non-production credentials and reviewed payment authority.

## Activation boundary

Travelport `reservation` remains unadvertised. Production activation still requires the reviewed PCI-safe FormOfPayment/guarantee source, live SearchComplete → Rules → Availability → Create → reviewed Create → Sync/recovery verification, and authoritative live `13034` / locator-less recovery semantics.

## Provider references

- Travelport shared Reservation Retrieve API Reference, Receipt object.
- Travelport Hotel v11 Create Reservation Reference Payload.
- Travelport Hotel v11 Retrieve Hotel Reservation.
- Travelport Hotel v11 Cancel Hotel Reservation.
- `docs/travelport-stays-receipt-evidence.md`.
- `docs/travelport-stays-receipt-token-authority.md`.
