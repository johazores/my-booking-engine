# Australian commercial-amendment increasing adjustment readiness

## Purpose

SF supports a deliberately narrow Australian hospitality adjustment contract for the first commercial amendment that increases consideration after an Australian tax invoice has been issued. The implemented lifecycle now includes legal/commercial readiness, immutable schema-version-4 persistence, a serializable writer, bounded post-issuance verification, tenant-scoped staff reads, capability-owned public reads, accounting/reconciliation, HTML/print, deterministic PDF delivery, and direction-aware product issuance.

The contract remains AU/AUD, fully taxable standard GST, one applied `ADDITIONAL_CHARGE` amendment, one exact immutable `COMMERCIAL_AMENDMENT_TARGET` pricing-evidence record, complete provider-neutral settlement, and zero earlier adjustment notes against the source invoice. Cumulative increasing or mixed-direction chains are not inferred and continue to fail closed.

## Official Australian basis

The contract was reviewed against ATO GSTR 2013/2 on 5 September 2026. That ruling describes a change in consideration as an adjustment event, distinguishes increasing and decreasing GST adjustments, and explains adjustment-note rules that can apply after a tax invoice. Jurisdiction/legal review remains required before SF represents the broader lifecycle as compliant for all Australian cases.

## Readiness authority

`assessAustralianCommercialAmendmentIncreasingAdjustmentReadiness` requires:

- a valid immutable AU/AUD source tax-invoice price under the supported fully taxable standard-GST contract;
- an `APPLIED` commercial amendment with direction `ADDITIONAL_CHARGE` and a strictly positive persisted delta;
- application not earlier than source-invoice issue time;
- an amendment before-price equal to the immutable source tax invoice and an after-price equal to the exact immutable target-pricing evidence;
- exact positive GST-exclusive, GST and GST-inclusive increases, including one-eleventh GST under the supported contract;
- provider-neutral settlement `READY_TO_APPLY`, zero remaining adjustment, exact settled increase and net settlement equal to the amended after-total; and
- zero prior adjustment notes against the source invoice.

`getHospitalityCommercialAmendmentIncreasingAdjustmentNoteAvailability` and the writer independently reload the tenant-owned source invoice, amendment, exact target-pricing record, prior-adjustment authority and complete booking payment ledger. Browser/provider input cannot supply GST, money, pricing fingerprints, settlement truth, numbering, sequence, issue time or legal direction.

## Immutable persistence and writer

`HospitalityIssuedAdjustmentNote` makes legal direction material through `adjustmentType` plus mutually exclusive decrease/increase columns. Schema version 4 represents first-only `INCREASING / COMMERCIAL_AMENDMENT` evidence at source ordinal `1`, with no refund or predecessor authority, zero decrease columns and exact positive increase subtotal/GST/total columns.

`issueHospitalityCommercialAmendmentIncreasingAdjustmentNote` requires `payment:manage` and performs the authoritative write in a serializable transaction with bounded uniqueness/serialization retries. It reloads the immutable source invoice, exact applied amendment, exactly one target-pricing record, complete provider-neutral payment ledger and zero earlier adjustment notes. It also rejects another applied refund or additional-charge amendment sharing the same immutable source baseline before allocating the shared tenant `AU / ADJUSTMENT_NOTE` sequence.

The writer derives issue time and all legal money server-side, creates the schema-version-4 snapshot, persists the material columns, immediately reparses/revalidates the created row, is idempotent by tenant-owned commercial-amendment authority, and records a tenant-scoped audit event.

## Post-issuance authority

`verifyHospitalityCommercialAmendmentIncreasingAdjustmentRows` is the reusable actor-neutral post-issuance verifier. It accepts at most 100 references per call, tenant-scopes every reload, and independently re-proves source invoice, exact applied amendment, unique target pricing, full booking payment ledger, sole source-adjustment authority, source-baseline uniqueness, chronology, standard GST, material columns and fingerprints.

Authenticated adjustment-note reads require `booking:read` plus `payment:read`. Public history first verifies tenant slug, encrypted booking capability, persisted booking ownership, an unexpired principal and the tenant-owned booking. Only then can schema-version-4 evidence enter the customer-safe projection. Internal amendment, target-pricing, payment/provider, predecessor and fingerprint fields are not exposed unless legally required.

## Direction-aware product issuance

`hospitality-commercial-amendment-adjustment-product-service.ts` is the shared product boundary for commercial-amendment adjustment notes. It requires `payment:manage`, tenant- and booking-scopes source-document lookup, and derives legal direction from persisted amendment authority rather than request data.

For a source invoice with no existing adjustment chain, the product boundary preserves the existing decreasing readiness path first and then considers the supported first-increasing readiness. It rejects ambiguous applied amendments sharing the selected legal baseline across `REFUND` and `ADDITIONAL_CHARGE`. A first increasing action is exposed only when the server returns `adjustmentType = INCREASING`, ordinal `1`, and the exact eligible amendment id.

The API request body still contains only `sourceInvoiceDocumentNumber`; the amendment id comes from the protected route. The browser never submits direction, GST, amount, currency, provider truth, settlement result, ordinal, predecessor, sequence or issue time. The tax-invoice action receives server-derived direction only for display and confirmation copy.

Exact increasing retries first pass the post-issuance authority verifier and then return through the idempotent increasing writer. Existing decreasing retries continue through the complete verified decreasing-chain orchestration. Any existing increasing document, cancellation authority, mixed legal history, or existing decreasing chain prevents SF from inventing unsupported cumulative/mixed-direction increasing semantics.

## Direction-aware delivery

Authenticated register/detail pages and public booking history render the verified direction, before/after price and directional GST effect. Accounting CSV carries an explicit `adjustment_type` and separate decrease/increase columns. Reconciliation consumes the verified tenant-scoped register. Authenticated and public PDF routes reuse the same verified direction-aware document projection and reject mixed or unreconciled effects.

The deterministic Windows-1252 limitation remains fail closed.

## Remaining production boundary

Cumulative increasing adjustments, mixed-direction chains, cancellation-after-amendment semantics, mixed taxability, partial/non-standard-GST adjustments, generic correction/void/reissue, durable customer re-authentication and email/resend, universal Unicode-safe PDF rendering, reviewed disposal/de-identification, full Node 24/Prisma/PostgreSQL execution, and jurisdiction/legal review remain separate production work.

## Validation boundary

Dependency-free source-contract coverage now includes direction-aware product authorization, bounded legal-history inspection, cross-direction candidate ambiguity, exact increasing retry verification, route request/response authority, and UI confirmation behavior. Full repository validation still requires the supported Node 24 dependency checkout and an explicitly disposable PostgreSQL target. GitHub Actions are not used.
