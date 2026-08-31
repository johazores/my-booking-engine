# Pricing

## Status

SF implements the production hospitality pricing foundation for normalized money/currency handling, persisted nightly base-rate windows, persisted taxes/fees, permission-checked pricing management, deterministic complete-price quotes, and price revalidation. The hospitality add-on domain contract is now defined and unit-covered, but add-on persistence, management UI, quote resolution, and booking snapshots are still incomplete and are not represented as finished. Provider-specific pricing rules and persisted booking price snapshots remain future work.

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

## Hospitality add-on contract

Hospitality add-ons are optional commercial selections, never automatic charges. The domain layer defines exact-money catalog input and deterministic selection semantics before persistence is added.

Supported pricing models are deliberately explicit:

- `PER_BOOKING`: one fixed amount for the booking regardless of room count or nights
- `PER_ROOM`: fixed amount multiplied by requested room quantity
- `PER_ROOM_NIGHT`: fixed amount multiplied by room quantity and stay nights
- `PER_UNIT`: fixed amount multiplied only by the explicit selected quantity

Catalog input supports a property-wide scope or a complete room-type/rate-plan scope, inclusive sell dates, exact currency minor units, bounded quantities, normalized codes, and descriptions. Selection input accepts at most 25 unique add-ons, validates UUID identifiers, caps selected quantity at 100, rejects duplicate IDs, and sorts selections deterministically for later quote fingerprinting.

A browser cannot multiply `PER_BOOKING`, `PER_ROOM`, or `PER_ROOM_NIGHT` add-ons through an arbitrary submitted quantity: those models accept a selected quantity of exactly one and derive their commercial multiplier from the normalized stay. Only `PER_UNIT` accepts a customer-selected quantity greater than one.

This contract is intentionally not wired into complete-price quotes yet. The next implementation step must persist tenant-owned add-on catalog records, resolve only active/in-scope selections server-side, include resolved add-on components in the complete pricing fingerprint, and protect relevant inventory/currency dependencies. Until those pieces exist, the Phase 10 add-on checklist item remains incomplete.

## Quote contract

`quoteHospitalityBasePrice` remains the normalized accommodation-only primitive: it consumes the same provider-independent stay scope used by availability (`propertyId`, `roomTypeId`, `ratePlanId`, arrival, departure, quantity), requires `pricing:read`, and resolves exactly one active nightly base rate for every occupied night.

`quoteHospitalityPrice` builds the current complete internal hospitality price by combining that accommodation subtotal with every applicable active charge rule. It returns:

- exact nightly minor-unit amounts
- accommodation subtotal
- individual applied tax/fee components
- tax total
- fee total
- final total
- currency
- a deterministic SHA-256 pricing fingerprint

The complete fingerprint includes effective nightly values and applied commercial adjustments. It contains no secret values and is not treated as authorization.

## Revalidation and price changes

`revalidateHospitalityBasePrice` preserves the accommodation-only contract and compares a prior base-price fingerprint against the latest base rates. `revalidateHospitalityPrice` recalculates the complete latest quote, including taxes and fees, and compares its complete fingerprint with the previously presented value. A base-rate change, tax/fee change, or charge archival therefore produces `changed: true` for complete-price revalidation and returns the latest total. Browser-submitted totals are never accepted as authoritative.

Revalidation accepts only canonical SHA-256 hexadecimal fingerprints. Malformed or truncated fingerprints are validation errors rather than being silently interpreted as legitimate stale-price values.

The future booking-creation transaction must use complete-price revalidation before permanent inventory confirmation and persist an immutable booking price snapshot. A displayed quote or browser redirect is never sufficient proof of the commercial amount to persist.

## Service boundaries

Pricing services defensively validate organization, actor, property, room-type, rate-plan, and pricing-resource UUIDs at exported boundaries rather than relying on route normalization. Pricing collections also bound pagination internally to a maximum page size of 50, even when called outside the current UI routes.

This duplicates critical safety checks intentionally: browser parsing improves UX, while service validation is the actual application boundary.

## Permissions and tenancy

- platform/organization admins and managers: `pricing:read`, `pricing:manage`
- staff: `pricing:read`
- customer-role organization memberships: no internal pricing access

All reads/writes validate organization membership and permission server-side. Resource identifiers are tenant/property scoped before database access. Composite foreign keys independently prevent charge rules from referencing inventory or rate plans from another tenant/property.

## UI

`/pricing` is the real authenticated pricing workspace. A property pricing screen manages base-rate windows and links directly to `/pricing/[property-id]/charges`, where users can review paginated tax/fee history, browse paginated sellable scopes, create property-wide or scoped rules, and archive active rules. Archived properties and users without manage permission receive read-only states.

The interface reuses the existing SF application shell, responsive inventory tables/cards, focus behavior, status messaging, validation states, and design tokens rather than introducing a second design system.

No add-on management interface is exposed yet because there is not yet a persisted add-on catalog. SF does not present a dead or mock add-on route as complete.

## Validation coverage

The standard unit command includes money, base-rate, charge-rule, pricing-boundary, and hospitality add-on domain tests. Add-on domain tests cover exact currency conversion, complete optional sellable scope, unsupported price models, malformed/zero prices, deterministic unique selection normalization, each supported multiplier, quantity bounds, and prevention of browser quantity multiplication for non-unit add-ons. Pricing-boundary tests cover defensive pagination and canonical fingerprint validation. The disposable PostgreSQL suite includes hospitality pricing coverage for exact minor-unit persistence, role enforcement, tenant denial, overlap rejection, concurrent base-rate writes, concurrent same-code property/scoped charge writes, dependency protection, organization-currency protection, multi-night/quantity quote totals, applied percentage/fixed charges, audit events, and changed-price revalidation.

Full repository validation still requires Node 24 and an explicitly disposable PostgreSQL target.

## Next dependencies

Complete add-ons by adding tenant-safe persistence, lifecycle/dependency guards, management UI, selected-add-on quote resolution, fingerprint/revalidation integration, and PostgreSQL coverage. Any tenant/provider pricing rules should only be introduced when a real business/provider requirement exists rather than speculatively.

Once the complete internal price contract is sufficient for booking creation, the booking transaction can atomically revalidate price, convert/consume a hold (or directly allocate), and persist an immutable booking price snapshot without trusting the browser.
