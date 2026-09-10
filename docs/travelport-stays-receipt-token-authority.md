# Travelport Stays receipt token authority

## Purpose

Travelport Stays reservation receipts can move SF from provider uncertainty into durable reservation identity, supplier confirmation, cancellation lifecycle evidence, or Booking.com Sync recovery. Provider-owned receipt tokens are therefore treated as exact evidence rather than user-entered text that SF may normalize.

This boundary is provider-specific and shared by initial Create, reviewed Create, Booking.com Sync, and known-locator Retrieve through `travelport-stays-reservation-receipt-evidence.ts`. It does not enable the Travelport `reservation` capability.

## Current provider evidence

Travelport's current Hotel v11 Create, Retrieve, Sync, and Cancel examples use canonical JSON values for the relevant receipt families. Examples include `ReceiptConfirmation`, `ConfirmationHold`, `OfferStatusHospitality`, `PNR Locator`, `Confirmation Number`, `Cancellation Number`, `Travelport`, `Supplier`, `Confirmed`, `Cancelled`, supplier source codes such as `BO`, and offer references such as `O1`.

Travelport's current shared Air Reservation Retrieve documentation also demonstrates why this parser must stay multi-content aware: an NDC receipt can use `ReceiptConfirmation`, `ConfirmationHold`, `sourceContext=VendorLocator`, and `OfferStatusAir` with `StatusAir` while coexisting with hotel content in the same reservation model. That foreign air evidence is not Stays authority and must remain outside hotel receipt normalization.

Those values are machine-owned identifiers and discriminators. SF must not turn a padded or control-character-bearing provider token into valid commercial evidence merely by trimming or otherwise normalizing it.

## Fail-closed rule

For Stays receipt evidence, bounded provider strings must already be in canonical unpadded form and must not contain ASCII control characters (`U+0000` through `U+001F` or `U+007F`). Leading or trailing whitespace, embedded tab/NUL/control bytes, or oversized values on a receipt discriminator, confirmation/cancellation discriminator, locator value, locator type, source context, supplier source, offer-status discriminator, lifecycle status, or supported `OfferRef` is invalid rather than normalized.

Supported Stays receipts also validate `OfferRef` at the shared receipt boundary before caller-specific ownership rules run. A present `OfferRef` must be a non-empty bounded array of unique, unpadded, control-free string references. Explicit `null`, malformed elements, empty/oversized arrays, duplicate references, padded references, and control-bearing references fail closed.

Caller-specific rules remain stronger where required. In particular, the commercial Create/Sync classifier still requires a supplier confirmation to belong to the expected offer and still requires the Travelport PNR to remain reservation-level. Known-locator Retrieve still validates active/passive offer ownership before allowing receipt evidence to establish the active reservation.

## Multi-content compatibility

Canonical unrelated `ReceiptPayment` evidence remains outside Stays locator authority. A receipt that claims `ReceiptPayment` but also presents a `Confirmation` or `Cancellation` reservation branch is contradictory and fails closed; likewise, confirmation and cancellation branches cannot coexist on one receipt or contradict the outer confirmation/cancellation receipt type. Generic shared-model confirmation/cancellation evidence remains subject to the existing multi-content rules in `docs/travelport-stays-receipt-evidence.md`.

The current Travelport NDC `VendorLocator` + `OfferStatusAir/StatusAir` receipt shape remains valid unrelated multi-content evidence. The Stays inspector does not reinterpret or require hotel-specific status fields from that air receipt. Conversely, a receipt that claims a recognized Stays source context, locator type, or `OfferStatusHospitality` cannot escape the fail-closed hotel boundary by presenting malformed tokens.

This hardening does not reinterpret foreign content as Stays. It prevents malformed provider-owned Stays receipt structure or machine tokens from being converted into omission or canonical Stays authority.

## Validation

Focused regression coverage checks canonical confirmations, Travelport PNR evidence, relevant cancellation evidence, every commercially meaningful receipt token family, embedded tab/NUL/other ASCII control characters in locator/source/offer-scope authority, padded and duplicate `OfferRef` values, explicit-null/malformed offer-scope evidence, canonical unrelated payment-receipt compatibility, the current NDC `VendorLocator` + `OfferStatusAir/StatusAir` compatibility shape, and outer receipt/confirmation/cancellation branch exclusivity.

Dependency-free source contracts pin the exact-value and ASCII-control guard, require offer-scope validation to remain active for supported confirmation and relevant Stays cancellation receipts, and prevent typed payment or mixed reservation branches from bypassing the shared inspector.

Full repository validation still requires the repository-supported Node 24 / TypeScript 6 dependency environment. PostgreSQL scenarios require an explicitly disposable target, and live Travelport verification requires provisioned non-production credentials and reviewed payment authority.

## Activation boundary

Travelport `reservation` remains unadvertised. Production activation still requires the reviewed PCI-safe FormOfPayment/guarantee source, live SearchComplete → Rules → Availability → Create → reviewed Create → Sync/recovery verification, and authoritative live `13034` / locator-less recovery semantics.

## Provider references

- Travelport Hotel v11 Create Reservation Reference Payload.
- Travelport Hotel v11 Retrieve Hotel Reservation.
- Travelport Hotel v11 Sync Reservation.
- Travelport Hotel v11 Cancel Hotel Reservation.
- Travelport Air v11 Reservation Retrieve API Reference.
- `docs/travelport-stays-receipt-evidence.md`.
- `docs/travelport-stays-receipt-branch-authority.md`.
- `docs/travelport-commercial-receipt-scope.md`.
