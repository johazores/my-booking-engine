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

The domain layer now has an explicit cumulative predecessor-chain contract for future repeated decreasing commercial amendments. It can assess a second or later amendment only when the caller supplies the complete already-verified legal chain.

That chain must be linear and contiguous from source ordinal `1`; preserve unique adjustment/document identity; move forward chronologically; begin from the immutable source tax-invoice price; link each predecessor after-price exactly to the next predecessor before-price; preserve fully taxable standard GST for every decrease; and finish at the new amendment before-price. The assessment returns the expected next ordinal and immediate predecessor identity only after the chain passes.

This does not enable repeated issuance. Current services still pass only the count of prior adjustment notes, so the domain deliberately returns a blocking requirement when prior documents exist without complete verified chain evidence.

## Immutable repeated-document contract

First commercial-amendment documents remain schema version 2 and ordinal `1`.

The commercial snapshot domain now also defines schema version 3 for a future repeated commercial-amendment adjustment note. A schema-version-3 snapshot requires ordinal `2` or greater and binds the immediate predecessor adjustment-note id, document number, issue timestamp, document fingerprint, and predecessor after-pricing fingerprint. The latter must equal the new document before-pricing fingerprint.

The schema-version-3 parser fails closed on missing predecessor evidence, ordinal gaps, chronology errors, self-predecessor document numbers, malformed fingerprints, hidden predecessor fields in schema version 2, and predecessor/before-pricing mismatch. The predecessor evidence is part of the canonical document fingerprint, so it cannot be changed without changing the legal-document fingerprint.

## Persistence and database integrity

`HospitalityIssuedAdjustmentNote` still carries nullable cancellation/commercial authority columns plus `sourceAdjustmentOrdinal`. PostgreSQL currently fixes the ordinal to `1` and enforces one `(organizationId, sourceInvoiceId, sourceAdjustmentOrdinal)` record. There is not yet a persisted predecessor-adjustment relation.

The database independently enforces the current issued contract:

- AU/AUD adjustment-note identity and numbering shape;
- reason-specific authority exclusivity;
- source ordinal `1`;
- tenant + booking composite foreign keys to source invoice and reason-specific authority;
- schema-version-1 cancellation versus schema-version-2 commercial snapshot shape;
- material decrease/fingerprint agreement; and
- commercial before/after standard-GST reconciliation inside the immutable snapshot.

Schema version 3 is therefore domain-only readiness. It cannot be persisted or issued until a migration adds same-tenant/same-booking/same-source predecessor authority, no-fork protection, contiguous ordinal checks, and schema-version-3 JSON/material-column constraints.

## Authorization and issuance

Both current issuance paths require `payment:manage`. The browser cannot supply legal seller/buyer identity, ABN, reason, GST, money, sequence, provider truth, fingerprints, or settlement authority.

First commercial-amendment issuance re-runs readiness inside a serializable transaction, binds the exact amendment + target-pricing identities, allocates the shared `AU / ADJUSTMENT_NOTE` sequence atomically, creates the schema-version-2 snapshot/fingerprint, writes a safe audit event, and is idempotent by commercial-amendment authority. Concurrent first-adjustment issuance remains protected by the tenant/source/ordinal unique contract plus serializable retry handling.

The authenticated tax-invoice page exposes a real commercial-amendment issuance action only when one unambiguous first amendment is ready. Existing cancellation issuance retains priority when its supported event is available, avoiding competing legal-document primary actions. No repeated-adjustment primary action exists.

## Authenticated reads, accounting, and reconciliation

Authenticated adjustment-note reads require both `booking:read` and `payment:read` and support both current issued reasons. The shared read boundary validates:

- persisted row, schema-version-specific snapshot, material columns, and document fingerprint;
- the complete immutable source tax invoice;
- cancellation refund authority for cancellation notes; or
- applied amendment + exact target pricing evidence for first commercial-amendment notes.

The authenticated adjustment register and detail page use that shared validated projection. Accounting CSV export also uses it, and tenant tax-document reconciliation validates the complete current adjustment-note register.

Unknown authority, cross-tenant links, stale/malformed evidence, source-invoice drift, unsupported repeated persistence, or unsupported document reason fail closed.

## Customer document and PDF boundary

The authenticated HTML adjustment-note document supports both current issued reasons and clearly shows the source tax invoice, reason, before/after amount, and exact GST decrease.

The deterministic server PDF also supports both current issued reasons. It keeps cancellation semantics strict (`before = decrease`, `after = 0`) and first commercial-amendment semantics strict (`before > after`, `before - after = decrease`), uses exact AUD minor units, and emits reason-specific explanatory text from the verified immutable document projection. Unsupported legal text continues to fail closed under the current WinAnsi font contract.

Public booking-capability history and PDF delivery support both current issued reasons. Public reads first verify the organization slug, encrypted booking capability, persisted booking ownership, unexpired matching public principal, and tenant-owned booking. They then revalidate each adjustment row, the complete immutable source tax invoice, and the reason-specific refund or first-commercial-amendment/target-pricing authority before exposing the customer-safe projection. Provider references, refund IDs, amendment IDs, target evidence IDs, fingerprints, actors, credentials, and secrets remain server-only.

## Unsupported adjustments

Repeated/cumulative adjustment **issuance** remains unsupported even though its domain and immutable-snapshot contracts are now defined. Partial adjustments, increasing adjustments, cancellation-after-amendment semantics, mixed taxability, arbitrary staff-entered reasons, generic reissue/void/correction workflows, non-AUD documents, and other jurisdictions also remain unsupported and must fail closed.

## Legal and operational boundary

Australian Taxation Office guidance treats cancellation or a change in consideration as an adjustment event. SF does not treat this implementation or documentation as legal advice. Durable customer authentication/history, email/resend, universal Unicode-safe PDF support, reviewed disposal/de-identification, production Node 24/PostgreSQL verification, and jurisdiction/legal review remain separate production work.
