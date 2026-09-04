# Australian adjustment notes

## Purpose

SF has a deliberately narrow Australian decreasing-adjustment lifecycle for previously issued hospitality tax invoices. The original tax invoice remains immutable. An adjustment note is a separately numbered legal document with its own immutable evidence; this is not a generic credit-note button.

The currently issued contract remains AU/AUD and fully taxable standard GST.

## Supported issued events

SF currently supports two first-adjustment issuance authorities.

### Booking cancellation

`BOOKING_CANCELLATION` requires:

- a verified persisted Australian tax invoice for the active tenant + booking;
- booking status `CANCELLED` and payment status `REFUNDED`;
- exactly one attributed successful non-commercial-amendment full refund matching the source invoice currency and total;
- a persisted settlement-source reference; and
- exact standard-GST reconciliation.

The immutable schema-version-1 document keeps the exact `refundTransactionId` as legal authority.

### Commercial amendment

The currently issued `COMMERCIAL_AMENDMENT` contract requires:

- the verified source tax invoice to match the amendment frozen before-price and pricing fingerprint exactly;
- one exact applied `REFUND` commercial amendment belonging to the same tenant + booking;
- exactly one immutable `COMMERCIAL_AMENDMENT_TARGET` pricing-evidence row matching the amendment after-price;
- exact standard GST before and after;
- the complete provider-neutral booking settlement to reconcile to the applied after-total; and
- no prior issued adjustment note against the source tax invoice.

The immutable schema-version-2 document keeps the exact `commercialAmendmentId` and `targetPricingEvidenceId` as legal authority. It deliberately does not persist one refund transaction because amendment settlement can span multiple payment sources.

## Repeated commercial-amendment readiness foundation

The domain layer has an explicit cumulative predecessor-chain contract for future repeated decreasing commercial amendments. It can assess a second or later amendment only when the caller supplies the complete already-verified legal chain.

That chain must be linear and contiguous from source ordinal `1`; preserve unique adjustment/document identity; move forward chronologically; begin from the immutable source tax-invoice price; link each predecessor after-price exactly to the next predecessor before-price; preserve fully taxable standard GST for every decrease; and finish at the new amendment before-price. The assessment returns the expected next ordinal and immediate predecessor identity only after the chain passes.

Current issuance still does not supply that predecessor-chain evidence, so a source invoice with an existing adjustment continues to fail closed. The persisted chain foundation described below removes the database-shape blocker without making repeated issuance reachable.

## Immutable repeated-document contract

First commercial-amendment documents remain schema version 2 and ordinal `1`.

The commercial snapshot domain defines schema version 3 for a future repeated commercial-amendment adjustment note. A schema-version-3 snapshot requires ordinal `2` or greater and binds the immediate predecessor adjustment-note id, document number, issue timestamp, document fingerprint, and predecessor after-pricing fingerprint. The latter must equal the new document before-pricing fingerprint.

The schema-version-3 parser fails closed on missing predecessor evidence, ordinal gaps, chronology errors, self-predecessor document numbers, malformed fingerprints, hidden predecessor fields in schema version 2, and predecessor/before-pricing mismatch. Predecessor evidence participates in the canonical document fingerprint.

## Persistence and database integrity

`HospitalityIssuedAdjustmentNote` now has explicit nullable predecessor authority:

- `predecessorAdjustmentNoteId` identifies the immediate predecessor legal document;
- `predecessorSourceAdjustmentOrdinal` freezes the ordinal expected on that predecessor; and
- `sourceAdjustmentOrdinal` remains unique within the tenant + source invoice.

PostgreSQL preserves all existing ordinal-1 cancellation/schema-version-1 and commercial/schema-version-2 rows. Repeated commercial rows are structurally allowed only at ordinal `2` or greater and must use schema version 3.

The cumulative-chain migration independently enforces:

- the immediate predecessor belongs to the same booking, organization, original source invoice, adjustment reason, and exact predecessor ordinal through one composite self foreign key;
- ordinal continuity through `predecessorSourceAdjustmentOrdinal = sourceAdjustmentOrdinal - 1`;
- no self-predecessor;
- one-successor/no-fork semantics through a unique predecessor id;
- cancellation remains ordinal `1` with no predecessor authority;
- first commercial adjustment remains ordinal `1` with no predecessor authority;
- repeated commercial adjustment requires predecessor authority and schema-version-3 snapshot identity; and
- schema-version-3 JSON binds the persisted predecessor id and preserves exact before/after standard-GST decrease checks, including predecessor-after/before pricing-fingerprint continuity inside the immutable snapshot.

The database does not make repeated issuance reachable by itself. Application read/issuance code must still revalidate the actual predecessor immutable document number, issue time, document fingerprint, after-pricing fingerprint, amendment authority, and complete chain before accepting or exposing a repeated legal document.

## Authorization and current issuance

Both current issuance paths require `payment:manage`. The browser cannot supply legal seller/buyer identity, ABN, reason, GST, money, sequence, provider truth, fingerprints, or settlement authority.

First commercial-amendment issuance re-runs readiness inside a serializable transaction, binds the exact amendment + target-pricing identities, allocates the shared `AU / ADJUSTMENT_NOTE` sequence atomically, creates the schema-version-2 snapshot/fingerprint, writes a safe audit event, and is idempotent by commercial-amendment authority.

The authenticated tax-invoice page exposes a real commercial-amendment issuance action only when one unambiguous first amendment is ready. Existing cancellation issuance retains priority when its supported event is available. No repeated-adjustment primary action exists.

## Authenticated reads, accounting, and reconciliation

Authenticated adjustment-note reads require both `booking:read` and `payment:read` and support the two currently issued ordinal-1 reasons. The shared read boundary validates persisted row, immutable snapshot/material columns/fingerprint, the complete immutable source tax invoice, and reason-specific authority.

The authenticated adjustment register, detail page, accounting CSV export, and tenant tax-document reconciliation continue to fail closed on unsupported repeated persistence until their predecessor-chain validation is implemented. The new database shape must not be interpreted as downstream read support.

## Customer document and PDF boundary

The authenticated HTML adjustment-note document and deterministic server PDF support the two current ordinal-1 reasons. Public booking-capability history and PDF delivery use the same reason-specific legal evidence checks after independent customer authorization.

Repeated schema-version-3 HTML/PDF/public delivery remains unavailable until the read boundary validates the persisted predecessor chain end to end. Provider references, payment transaction ids, amendment ids, target evidence ids, fingerprints, actors, credentials, and secrets remain server-only on customer-safe projections.

## Unsupported adjustments

Repeated/cumulative adjustment **issuance and delivery** remain unsupported even though the domain, immutable snapshot, and database-chain contracts now exist. Increasing adjustments, cancellation-after-amendment semantics, mixed taxability, arbitrary staff-entered reasons, generic reissue/void/correction workflows, non-AUD documents, and other jurisdictions also remain unsupported and must fail closed.

## Legal and operational boundary

Australian Taxation Office guidance treats cancellation or a change in consideration as an adjustment event. SF does not treat this implementation or documentation as legal advice. Durable customer authentication/history, email/resend, universal Unicode-safe PDF support, reviewed disposal/de-identification, production Node 24/PostgreSQL verification, and jurisdiction/legal review remain separate production work.
