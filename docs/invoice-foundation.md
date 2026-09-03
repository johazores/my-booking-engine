# Invoice and legal pricing evidence foundation

## Status

SF now persists immutable booking pricing evidence for newly accepted hospitality commercial states. This is a production data foundation for future jurisdiction-specific invoices and tax documents; it is **not** itself a legal invoice implementation.

The existing customer-safe payment receipt remains the supported customer settlement document. It must not be relabeled as a tax invoice, fiscal receipt, credit note, or other jurisdiction-regulated document until the required legal data and document lifecycle are implemented.

## Persisted pricing evidence

`HospitalityBookingPricingEvidence` is an append-only application record scoped by organization and booking. When applicable it is also bound to a commercial amendment through the same organization + booking + amendment identity enforced by the database.

Each evidence row freezes:

- organization, booking, and optional commercial-amendment ownership;
- a deterministic evidence key and evidence source;
- the observed booking version;
- property, room type, rate plan, arrival/departure dates, quantity, and normalized add-on selections;
- exact currency and accommodation/tax/fee/add-on/final minor-unit aggregates;
- the accepted pricing fingerprint; and
- a canonical schema-versioned pricing breakdown containing occupied-night prices, applied tax/fee rules, and selected add-ons with stable identifiers, codes, labels, calculations, quantities, and exact amounts.

The database independently enforces tenant/resource foreign keys, commercial-amendment ownership, valid date/quantity/currency/fingerprint shapes, aggregate money reconciliation, JSON shape, deterministic organization-scoped evidence identity, and amendment/source consistency.

## Accepted-state write boundaries

Pricing evidence is written inside the same protected database transaction as the commercial state it represents:

- booking confirmation writes `BOOKING_CONFIRMATION` evidence from the authoritative transactional quote before the confirmation transaction commits;
- same-price rescheduling writes `BOOKING_RESCHEDULE` evidence for the accepted new stay and refreshed pricing identity;
- zero-delta room/rate/quantity/add-on modification writes `BOOKING_COMMERCIAL_MODIFICATION` evidence for the accepted new commercial selection; and
- a prepared non-zero commercial amendment writes `COMMERCIAL_AMENDMENT_TARGET` evidence for the exact target quote before any amendment-owned external settlement is allowed to proceed.

The evidence domain rebuilds and validates the canonical line-item snapshot before persistence. It fails closed if nightly coverage, quantity, selected add-ons, tax/fee/add-on totals, final total, currency, or pricing fingerprint do not reconcile to the authoritative commercial state.

Prepared amendment target evidence is intentionally frozen before provider settlement. Human-readable pricing labels are not part of the pricing fingerprint, so retaining the reviewed labels at preparation prevents a later catalog rename from rewriting the descriptive evidence associated with the accepted amendment target.

## Tenant and authorization boundary

No public or browser input can create authoritative pricing evidence directly. Evidence is produced only by existing server-side booking and amendment services after their normal permission, tenant, inventory, pricing, idempotency, and transaction checks have succeeded.

The evidence table has no public write route and no client-controlled organization/booking/amendment ownership fields. Composite database constraints prevent cross-tenant or cross-booking attachment even if an application bug attempted an inconsistent insert.

## Legacy records and backfill policy

Bookings and amendments created before the pricing-evidence migration can legitimately have no `HospitalityBookingPricingEvidence` row. SF must not fabricate historical legal line items by re-reading today's mutable pricing configuration because names, tax rules, applicability, and other descriptive/legal facts may have changed since the original transaction.

Any future legal invoice issuer must therefore fail closed when required historical evidence is absent unless a deliberate, audited reconciliation/backfill process can prove the original facts from trustworthy historical records. There is no automatic unsafe backfill in this migration.

## What this does not implement

The following remain explicit production requirements before SF can claim jurisdiction-specific invoice or tax-document issuance:

- legal issuer identity and immutable business address/contact data;
- tax registration identifiers and jurisdiction-specific registration state;
- customer legal/billing identity fields where required;
- jurisdiction and tax-characterization rules, exemptions, inclusive/exclusive tax semantics, and legally required tax fields;
- tenant/jurisdiction-scoped fiscal numbering sequences with concurrency-safe uniqueness and immutable issuance timestamps;
- invoice versus receipt versus credit-note/document lifecycle semantics, including correction/void/reissue rules;
- legally required wording, currency/exchange-rate disclosures, localization, and retention requirements;
- deterministic document rendering/PDF generation from immutable evidence;
- authenticated/public-safe document access, delivery/email, resend/history, and revocation rules;
- accounting/export/provider integration requirements where product scope requires them; and
- explicit production validation for each supported jurisdiction.

No invoice UI, PDF, email action, fiscal number, tax-registration value, or legal wording should be introduced until the corresponding persisted authority exists. Placeholder or inferred legal data is not acceptable.

## Next dependency

The next coherent invoice slice is the legal issuer/jurisdiction configuration and immutable issuance model. It should define the minimum supported jurisdiction contract first, then add concurrency-safe numbering and document lifecycle state before rendering or delivery is exposed to users.
