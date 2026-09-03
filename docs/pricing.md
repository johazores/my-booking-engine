# Pricing

## Status

SF implements the production hospitality pricing foundation for normalized money/currency handling, persisted nightly base-rate windows, persisted taxes/fees, persisted optional add-ons, permission-checked pricing management, deterministic complete-price quotes, transactional revalidation, booking-level aggregate price snapshots, deterministic pricing identity, and append-only accepted-state line-item pricing evidence. Provider-specific pricing rules and jurisdiction-specific legal invoice/tax issuance remain future work.

## Money model

Money is never stored or calculated with JavaScript floating-point values. Persisted amounts use integer minor units (`BIGINT`) plus a canonical three-letter currency code. Form input is parsed according to the runtime currency minor-unit rules, so currencies such as JPY (0 decimals), PHP/USD (2), and BHD (3) are handled without rounding through binary floats.

Pricing arithmetic rejects negative components and values outside SF's bounded commercial range. Service/audit payloads serialize bigint values to decimal strings before JSON use.

## Hospitality base rates

`HospitalityBaseRate` belongs to exactly one tenant/property/room-type/rate-plan pricing scope and stores an inclusive date window, positive nightly minor-unit amount, currency, lifecycle, and timestamps.

Composite foreign keys require the organization, property, room type, and rate plan to belong to one consistent tenant/property scope. Creation additionally requires an active room-type/rate-plan assignment. Active base-rate windows cannot overlap for the same exact scope. Writes use a PostgreSQL transaction-scoped advisory lock for the pricing scope plus a serializable transaction so concurrent configuration requests cannot both create overlapping active windows.

Base rates are archived rather than edited in place. This preserves commercial history and gives later bookings a stable source from which to snapshot pricing inputs.

Active base rates also protect their commercial dependencies: a room-type/rate-plan assignment or rate plan cannot be removed/archived until its active prices are archived, and the organization currency cannot change while any active base rate still exists. This prevents otherwise-valid configuration changes from silently making current quotes unusable.

## Taxes and fees

`HospitalityChargeRule` models a tax or fee as real persisted commercial configuration. A rule belongs to one organization/property and is either property-wide or scoped to one active room-type/rate-plan assignment. Its inclusive date window controls which occupied nights it affects.

Supported calculations are intentionally explicit:

- `PERCENTAGE`: integer basis points from 1–10,000, applied to the eligible accommodation subtotal and rounded half-up to the nearest minor unit
- `FIXED_PER_BOOKING`: one exact fixed amount when at least one occupied night falls inside the rule window
- `FIXED_PER_ROOM_NIGHT`: exact fixed amount multiplied by eligible occupied nights and requested room quantity

Fixed rules store integer minor units and the active organization currency. Percentage rules do not persist a currency amount. Property-wide and exact-scope rules may stack when they have different codes, but an overlapping property-wide rule and scoped rule cannot reuse the same active code because that would double-apply one commercial charge ambiguously.

Charge creation requires `pricing:manage`, validates active tenant/property scope, validates the room-type/rate-plan assignment for scoped rules, serializes every potentially competing same-code write at the tenant/property/code level with a PostgreSQL advisory lock, and records safe audit metadata. Rules are archived rather than edited in place.

Active scoped charges prevent removing their room-type/rate-plan assignment or archiving the referenced rate plan. Active property charges prevent property archival. Active fixed charges also prevent changing organization currency until the fixed rules are archived. Percentage rules remain valid across a later currency change because they store no monetary amount.

## Hospitality add-ons

`HospitalityAddon` is a tenant-owned optional commercial catalog record. An add-on belongs to one organization/property and is either property-wide or scoped to a complete active room-type/rate-plan assignment. It stores name/code/description, an exact positive minor-unit amount, organization currency, pricing model, bounded selectable quantity, inclusive stay-applicability dates, lifecycle, and timestamps.

Supported pricing models are explicit:

- `PER_BOOKING`: one fixed amount for the booking regardless of room count or nights
- `PER_ROOM`: fixed amount multiplied by requested room quantity
- `PER_ROOM_NIGHT`: fixed amount multiplied by room quantity and occupied nights
- `PER_UNIT`: fixed amount multiplied only by the explicit selected quantity

Only `PER_UNIT` catalog entries may configure a maximum selected quantity greater than one. Quote selection accepts at most 25 unique add-ons and a quantity of 1–100 per selection. Duplicate identifiers are rejected and selections are sorted deterministically before pricing/fingerprinting. A browser cannot multiply `PER_BOOKING`, `PER_ROOM`, or `PER_ROOM_NIGHT` through an arbitrary submitted quantity.

An add-on is eligible only when it is active, belongs to the same tenant/property, applies property-wide or to the exact requested room-type/rate-plan scope, matches the quote currency, and its applicability window covers every occupied night. Departure itself is not treated as an occupied night. Selected quantities are checked again against the persisted catalog maximum server-side.

Catalog creation requires `pricing:manage`; reads and quote resolution require `pricing:read`. Writes use a PostgreSQL advisory lock scoped by tenant/property/code plus a serializable transaction so overlapping property-wide/scoped definitions with the same active code cannot be created concurrently. Add-ons are archived rather than edited in place and create/archive actions are audited.

Active add-ons protect their dependencies: scoped add-ons prevent room-type/rate-plan assignment removal and rate-plan archival; any active add-on prevents property archival and organization currency changes. Composite foreign keys independently enforce tenant/property ownership for scoped references.

## Quote contract

`quoteHospitalityBasePrice` remains the normalized accommodation-only primitive: it consumes the same provider-independent stay scope used by availability (`propertyId`, `roomTypeId`, `ratePlanId`, arrival, departure, quantity), requires `pricing:read`, and resolves exactly one active nightly base rate for every occupied night.

`quoteHospitalityPrice` builds the current complete internal hospitality price by combining that accommodation subtotal with every applicable active tax/fee rule and the caller's explicitly selected add-ons. It returns:

- exact nightly minor-unit amounts
- accommodation subtotal
- individual applied tax/fee components with stable identifiers/codes and human-readable labels
- tax total
- fee total
- resolved selected add-ons with stable identifiers/codes and human-readable labels
- add-on total
- final total
- currency
- a deterministic SHA-256 pricing fingerprint

The complete fingerprint includes effective nightly values, applied charge identity/calculation/amounts, and normalized resolved add-on identity/pricing/amounts. Human-readable labels are deliberately excluded from the fingerprint so a catalog display-name edit does not falsely create a commercial price change. The fingerprint contains no secret values and is not treated as authorization. The server never accepts browser-submitted totals as authoritative.

## Booking price snapshots, immutable evidence, and revalidation

`revalidateHospitalityBasePrice` preserves the accommodation-only contract and compares a prior base-price fingerprint against the latest base rates. `revalidateHospitalityPrice` recalculates the complete latest quote, including taxes, fees, and the same normalized add-on selections, and compares its complete fingerprint with the previously presented value.

A base-rate or charge change therefore produces `changed: true`. A selected add-on that is archived, moved out of the requested stay/scope, or otherwise no longer eligible fails revalidation as unavailable rather than silently dropping a customer selection from the total. Revalidation accepts only canonical SHA-256 hexadecimal fingerprints; malformed or truncated fingerprints are validation errors.

Booking confirmation performs the complete price quote again inside the protected booking transaction before permanent allocation is created. The persisted booking stores the authoritative currency, accommodation subtotal, tax total, fee total, add-on total, final total, normalized add-on selections, and pricing fingerprint. A displayed quote or browser redirect is never sufficient proof of the commercial amount persisted on a booking.

A same-price reschedule intentionally compares the persisted aggregate commercial snapshot rather than requiring the old fingerprint to match: nightly dates can legitimately change the pricing fingerprint even when all persisted totals remain identical. Once the new dates pass inventory/restriction checks and the latest aggregate quote still matches the persisted booking amount, the reschedule stores the new quote fingerprint in the same serializable transaction and records the before/after pricing identity in audit evidence. A reschedule that changes any persisted aggregate price component is rejected and must use the commercial-adjustment workflow.

Zero-delta commercial modifications and the final commercial-amendment apply transaction likewise replace the booking pricing fingerprint with the accepted current quote. This keeps the booking's pricing identity aligned with its current stay/commercial terms instead of leaving a fingerprint for superseded dates or selections.

`createHospitalityPricingBreakdownSnapshot` is the canonical schema-versioned line-item evidence builder. It validates nightly line coverage/order, tax/fee and add-on identities, labels, calculations, selected quantities, exact amounts, duplicate identities, aggregate reconciliation, currency, and the accepted pricing fingerprint. All money values are normalized to decimal strings suitable for immutable JSON persistence.

`HospitalityBookingPricingEvidence` now persists that canonical breakdown separately from the mutable booking row. For newly accepted states, SF writes evidence inside the same protected transaction as booking confirmation, same-price rescheduling, and zero-delta commercial modification. Preparing a non-zero commercial amendment also freezes the authoritative target quote as amendment-owned pricing evidence before external adjustment settlement can proceed. Evidence is scoped by organization/booking and, where applicable, by the same organization + booking + commercial-amendment identity enforced by the database.

Each evidence row freezes the commercial scope/stay/quantity/add-on selections, exact aggregate money, fingerprint, and complete nightly/tax/fee/add-on breakdown. Database checks enforce date/quantity/currency/fingerprint shape, aggregate money reconciliation, JSON shape, deterministic tenant-scoped evidence identity, source/amendment consistency, and composite tenant/resource foreign keys. There is no public or browser-authoritative write path for this table.

Bookings or amendments created before the pricing-evidence migration may legitimately have no evidence row. SF does not reconstruct historical legal line items from today's mutable pricing configuration because labels, tax rules, applicability, and other descriptive/legal facts may have changed. Any future legal document issuer must fail closed or use a deliberate audited historical reconciliation process when required evidence is absent.

This accepted-state pricing evidence is still **not a jurisdiction-specific legal invoice**. SF does not yet persist all required issuer/business identity, tax-registration identity, jurisdiction/tax characterization, billing identity, fiscal numbering, document lifecycle/credit-note semantics, required legal wording, localization/retention rules, rendering/delivery, or accounting evidence. See `docs/invoice-foundation.md` for the explicit legal boundary.

## Service boundaries

Pricing services defensively validate organization, actor, property, room-type, rate-plan, and pricing-resource UUIDs at exported boundaries rather than relying on route normalization. Pricing collections also bound pagination internally to a maximum page size of 50, even when called outside the current UI routes.

Add-on quote resolution additionally validates arrival/departure dates, verifies the caller-supplied stay-night count matches the normalized dates, bounds room quantity, resolves catalog records from persistence, and calculates all multipliers server-side.

This duplicates critical safety checks intentionally: browser parsing improves UX, while service validation is the actual application boundary.

## Permissions and tenancy

- platform/organization admins and managers: `pricing:read`, `pricing:manage`
- staff: `pricing:read`
- customer-role organization memberships: no internal pricing access

All reads/writes validate organization membership and permission server-side. Resource identifiers are tenant/property scoped before database access. Composite foreign keys independently prevent base rates, charge rules, add-ons, and persisted booking pricing evidence from referencing commercial resources from another tenant/property/booking.

## UI

`/pricing` is the real authenticated pricing workspace. A property pricing screen manages base-rate windows and links directly to `/pricing/[property-id]/charges` and `/pricing/[property-id]/addons`.

The add-on workspace supports paginated catalog history, paginated sellable-scope selection, property-wide or scoped creation, all four pricing models, exact currency amounts, optional descriptions, applicability dates, bounded per-unit quantities, archival, status/error feedback, and archived/read-only property states. It reuses the existing SF application shell, responsive inventory tables/cards, focus behavior, forms, status patterns, and design tokens rather than introducing another design system.

Pricing evidence currently has no standalone primary UI action. It is internal commercial evidence consumed by protected booking/amendment workflows and is intentionally not presented as a legal invoice.

## Validation coverage

The standard unit command includes money, base-rate, charge-rule, pricing-boundary, booking pricing-breakdown, booking pricing-evidence, reschedule-domain, and hospitality add-on domain tests. Pricing-breakdown/evidence tests cover canonical line-item evidence, strict persisted round-trip parsing, commercial-state matching, aggregate reconciliation, malformed schema rejection, stay drift, add-on drift, and transactional quote mismatch.

The disposable PostgreSQL suite additionally covers hospitality pricing/add-ons plus booking confirmation, rescheduling, and commercial modification. The pricing-evidence migration participates in the same guarded `prisma:validate` → deploy → status → drift database gate. A confirmed disposable PostgreSQL target is still required before claiming the new migration and persistence writes have passed integration validation.

Full repository validation still requires Node 24 and an explicitly disposable PostgreSQL target.

## Next dependencies

Advanced tenant/provider pricing rules should only be introduced when a real business/provider requirement exists rather than speculatively.

For invoice/tax work, immutable accepted-state pricing evidence is now in place for new booking/commercial states. The next coherent dependency is a deliberate legal issuer/jurisdiction configuration and issuance model: persist immutable issuer/tax-registration/billing authority, define supported jurisdiction/tax semantics, add concurrency-safe fiscal numbering and legal document lifecycle, and only then add invoice/credit-note rendering, authenticated delivery/email, and accounting integration. The existing customer-safe payment receipt remains separate from that legal invoice boundary.
