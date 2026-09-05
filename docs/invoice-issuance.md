# Invoice issuance

## Purpose

SF separates invoice preparation, jurisdiction readiness, immutable issuance, rendering, PDF projection, adjustment documents, accounting export, and delivery so browser input or mutable booking/customer data never becomes legal-document authority by accident.

The Australian foundation supports tax invoices, full-cancellation decreasing adjustment notes, direction-aware cumulative commercial-amendment adjustments, and one terminal cancellation after a verified commercial chain under the narrow AU/AUD fully taxable standard-GST contract.

## Persistence

`HospitalityInvoicePreparation` freezes accepted pricing evidence, issuer fingerprint, recipient snapshot/fingerprint, exact money, and preparation fingerprint. `HospitalityInvoiceNumberSequence` owns the next integer sequence by tenant, jurisdiction, and document type. `HospitalityIssuedInvoice` stores immutable tax-invoice identity/evidence.

`HospitalityIssuedAdjustmentNote` is direction-, reason-, ordinal-, and schema-specific:

- schema 1 / `DECREASING / BOOKING_CANCELLATION`, ordinal `1`: one exact full-refund authority for an unadjusted invoice;
- schema 2 / first `DECREASING / COMMERCIAL_AMENDMENT`, ordinal `1`;
- schema 3 / repeated `DECREASING / COMMERCIAL_AMENDMENT`, ordinal `2+`, including an increasing predecessor;
- schema 4 / first `INCREASING / COMMERCIAL_AMENDMENT`, ordinal `1`;
- schema 5 / repeated `INCREASING / COMMERCIAL_AMENDMENT`, ordinal `2+`; and
- schema 6 / terminal `DECREASING / BOOKING_CANCELLATION`, ordinal `2+`, bound to the immediate commercial predecessor and an ordered exact refund-authority set.

PostgreSQL constrains material direction/effect, ordinal shape, and predecessor integrity independently of application checks.

## Tax-invoice and cancellation issuance

`issueHospitalityAustralianTaxInvoice` requires `payment:manage`, revalidates preparation/recipient/issuer/pricing evidence and accepted booking commercial state, then derives sequence, number, issue time, legal snapshot, and fingerprint server-side.

`issueHospitalityCancellationAdjustmentNote` handles the schema-version-1 unadjusted cancellation case. It verifies the source invoice, cancelled/refunded booking state, one attributed successful full refund, and immutable money, and refuses any existing legal adjustment for the source invoice.

`issueHospitalityCancellationAfterAmendmentAdjustmentNote` handles the schema-version-6 terminal case. It requires `payment:manage`, selects the complete verified commercial chain under the existing source-chain advisory lock, re-derives the exact refund set and zero settlement, allocates the shared tenant AU adjustment-note sequence, persists canonical predecessor-bound evidence, immediately re-verifies the created row, retries supported write races, and writes an issuance audit without embedding individual refund IDs.

## Commercial-amendment product orchestration

`hospitality-commercial-amendment-adjustment-product-service.ts` is the product-facing direction-aware commercial boundary. It validates tenant/user/booking/source identifiers, requires `payment:manage`, verifies existing commercial history through the complete tenant/source legal chain, derives legal direction only from persisted amendment evidence, and rejects current-baseline ambiguity.

Decreasing readiness is evaluated against the current verified legal baseline whether the head is decreasing or increasing. If no supported decrease exists, repeated-increasing availability can select exactly one eligible `ADDITIONAL_CHARGE` from the same verified head. The product service dispatches decreasing ordinal `1`/`2+` to schemas 2/3 and increasing ordinal `1`/`2+` to schemas 4/5.

Same-baseline ambiguity checks are anchored to the current verified chain-head issue time so stale historical amendments from an earlier identical price point cannot become current authority.

## Terminal-cancellation product orchestration

`getHospitalityCancellationAfterAmendmentAdjustmentNoteAvailability` is evaluated before any new commercial-adjustment action on the tax-invoice page. It requires `payment:manage`, tenant + booking + source scope, complete commercial-chain verification, current cancelled/refunded state, and exact provider-neutral refund settlement.

The existing cancellation API supports both contracts without accepting terminal legal authority from the browser. Schema-version-1 requests contain the source invoice number plus the already server-derived single refund ID. Schema-version-6 requests contain only the source invoice number; the writer derives refund IDs, legal direction, GST, money, ordinal, predecessor, numbering, fingerprints, and issue time inside the protected server transaction.

The UI receives a schema-version-6 source ordinal only for confirmation display.

## Read and delivery convergence

Authenticated staff tax-document reads require `booking:read` plus `payment:read`; issuance requires `payment:manage`. Public reads first prove tenant slug, capability, ownership, unexpired principal, and the tenant-owned booking.

`hospitality-issued-adjustment-note-authority-service.ts` dispatches each legal shape to the appropriate verifier: legacy cancellation source/refund authority, terminal schema-version-6 commercial-chain/refund-set authority, or complete schema-version-2-through-5 commercial-chain authority.

Adjustment detail/register, accounting CSV, reconciliation, authenticated/public HTML, and deterministic PDF delivery inherit this shared boundary. Public customer-safe outputs exclude internal predecessor/amendment/target IDs, fingerprints, actors, and provider/payment/refund references unless legally required.

## Remaining production boundary

Mixed taxability, partial/non-standard-GST adjustment rules, generic reissue/void/correction, durable re-authenticated customer history, email/resend, universal Unicode-safe PDF rendering, reviewed disposal/de-identification, complete Node 24/Prisma/PostgreSQL production validation, and jurisdiction/legal review remain separate work.
