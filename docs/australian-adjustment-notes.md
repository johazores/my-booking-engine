# Australian adjustment notes

## Purpose

SF implements a deliberately narrow Australian adjustment lifecycle for previously issued hospitality tax invoices. The original tax invoice remains immutable. An adjustment note is separately numbered immutable legal evidence; SF does not provide a generic staff-entered credit-note workflow.

Reachable issuance is AU/AUD under the current fully taxable standard-GST contract. It supports full booking-cancellation decreases and direction-aware first/repeated commercial amendments whose server-derived baseline is the complete verified commercial chain head.

## Supported reachable events

### Booking cancellation

`DECREASING / BOOKING_CANCELLATION` requires a verified tenant-owned Australian tax invoice, cancelled/refunded booking state, exactly one attributed successful non-commercial full refund matching source total/currency, settlement-source authority and exact standard-GST reconciliation. Schema version 1 freezes the refund transaction and remains ordinal `1`.

Cancellation cannot be mixed into an existing commercial-amendment chain. Cancellation-after-amendment semantics remain fail closed.

### Decreasing commercial amendments

The first decrease requires the source tax invoice to equal the frozen amendment before-price, one exact applied `REFUND` amendment, exactly one target-pricing evidence record matching the after-price, exact standard GST, complete provider-neutral settlement, valid chronology and no earlier adjustment. It uses schema version 2 / ordinal `1`.

Repeated decreases use schema version 3 / ordinal `2+`. Each before-price must equal the verified predecessor after-price. Immutable evidence binds predecessor id/ordinal/document number/time/fingerprint and pricing continuity. The predecessor may be decreasing or increasing; its direction/schema/effect and settlement have already been independently proved by the complete source-chain verifier.

A later decrease after an increasing commercial adjustment is therefore supported only when one applied `REFUND` begins at the exact verified current chain-head price, immutable target pricing proves the new after-price, standard GST reconciles, chronology is valid, provider-neutral settlement is complete, and no competing current-baseline refund/additional-charge authority exists.

### Increasing commercial amendments

The first increase requires the immutable source tax invoice to equal the amendment before-price, exactly one applied `ADDITIONAL_CHARGE` amendment, exactly one immutable target-pricing record matching the after-price, exact positive standard-GST effect, complete provider-neutral settlement, valid chronology and zero earlier adjustment notes. It uses schema version 4 / ordinal `1`.

Schema version 5 is used for a repeated increasing commercial adjustment at ordinal `2+`. The current before-price must equal the complete verified chain-head after-price. Immutable evidence freezes predecessor identity, prior ordinal, document number/time/fingerprint, predecessor after-pricing fingerprint, and the exact positive increase effect. The predecessor may be decreasing or increasing.

Together, schema versions 2 through 5 support alternating commercial directions under the same narrow legal-evidence contract; direction is never caller-selected.

## Shared commercial legal-chain verification

The bounded tenant-scoped commercial adjustment chain verifier supports schema versions 2 through 5 and both increasing and decreasing directions. It rejects mixed non-commercial reasons, gaps, forks, duplicate authority, unsupported direction/schema combinations, baseline or target-pricing drift, chronology regressions, issuer/recipient changes, invalid standard-GST effects, and settlement that does not reconcile.

Each row's payment authority is independently re-proved from a progressive provider-neutral ledger restricted to transactions created no later than that document's issue time: base booking payment truth plus only commercial-amendment transactions belonging to the verified legal chain through that ordinal. This preserves historical settlement proof for earlier documents after later adjustments are added and prevents a future/unissued amendment from changing an earlier legal step's settlement baseline.

Repeated writers select the verified chain head under a tenant/booking/source PostgreSQL transaction advisory lock before persistence.

## Product issuance boundary

`getHospitalityNextCommercialAmendmentAdjustmentNoteAvailability` and `issueHospitalityNextCommercialAmendmentAdjustmentNote` are the product-facing boundary. They require `payment:manage`, tenant- and booking-scope source authority, derive direction from persisted amendments, preserve cancellation priority, verify existing commercial history through the complete chain, and reject ambiguous current-baseline candidates.

Decreasing readiness is evaluated first against the current verified legal baseline for both empty and existing commercial chains. If one supported `REFUND` is ready, the product boundary confirms no competing current-baseline refund/additional-charge amendment exists and dispatches schema version 2 for ordinal `1` or schema version 3 for ordinal `2+`. This includes a decrease whose immediate verified predecessor is increasing.

If no supported decrease is available for an existing chain, repeated-increasing availability searches the verified chain-head baseline for exactly one applied commercial amendment across both refund and additional-charge directions, requires that unique candidate to be `ADDITIONAL_CHARGE`, re-proves immutable target pricing and settlement, and requires cumulative readiness to return the exact next ordinal and predecessor. Ordinal `1` increasing issuance uses schema version 4; ordinal `2+` uses schema version 5.

Same-baseline ambiguity checks use the current verified chain-head issue time. Historical amendments applied before that legal baseline cannot become current authority merely because a later chain returns to an identical price/fingerprint.

Exact retries return an existing commercial adjustment note only after complete tenant/source chain membership is independently verified.

The API request body remains only `sourceInvoiceDocumentNumber`. The browser never selects legal direction, GST, money, ordinal, predecessor, provider truth, sequence or issue time. The UI receives server-derived direction and ordinal for presentation only.

## Read, accounting, reconciliation, HTML, and PDF delivery

Authenticated adjustment-note reads require `booking:read` plus `payment:read` and are tenant-scoped server-side. Public booking-capability history authorizes tenant slug, encrypted capability, persisted booking ownership, unexpired principal and tenant-owned booking before any legal document is returned.

`hospitality-issued-adjustment-note-authority-service.ts` sends every commercial row through the shared complete source-chain verifier. Staff detail/register/accounting, reconciliation, public history, authenticated/public HTML and deterministic PDF delivery therefore accept schema-version-2-through-5 evidence only when the complete chain proves it. Customer projections exclude internal predecessor/amendment/target ids, fingerprints, actors and provider/payment/refund references unless legally required.

## Remaining production boundaries

Cancellation-after-amendment, mixed taxability, partial/non-standard-GST rules, arbitrary staff-entered reasons, generic reissue/void/correction, non-AUD documents, other jurisdictions, durable customer authentication/history, email/resend, universal Unicode-safe PDF support, reviewed disposal/de-identification, complete Node 24/Prisma/PostgreSQL validation, and jurisdiction/legal review remain separate production work.
