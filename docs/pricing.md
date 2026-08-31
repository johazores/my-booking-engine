# Pricing

## Status

SF implements the first production hospitality pricing slice: normalized money/currency handling, persisted nightly base-rate windows, permission-checked pricing management, deterministic base-price quotes, and price revalidation. Taxes, fees, add-ons, provider-specific pricing rules, and persisted booking price snapshots remain future work and are not represented as complete.

## Money model

Money is never stored or calculated with JavaScript floating-point values. Persisted amounts use integer minor units (`BIGINT`) plus a canonical three-letter currency code. Form input is parsed according to the runtime currency minor-unit rules, so currencies such as JPY (0 decimals), PHP/USD (2), and BHD (3) are handled without rounding through binary floats.

Pricing arithmetic rejects negative components and values outside SF's bounded commercial range. Service/audit payloads serialize bigint values to decimal strings before JSON use.

## Hospitality base rates

`HospitalityBaseRate` belongs to exactly one tenant/property/room-type/rate-plan pricing scope and stores an inclusive date window, positive nightly minor-unit amount, currency, lifecycle, and timestamps.

Composite foreign keys require the room type and rate plan to belong to the same property and organization. Creation additionally requires an active room-type/rate-plan assignment. Active base-rate windows cannot overlap for the same exact scope. Writes use a PostgreSQL transaction-scoped advisory lock for the pricing scope plus a serializable transaction so concurrent configuration requests cannot both create overlapping active windows.

Base rates are archived rather than edited in place. This preserves commercial history and gives later bookings a stable source from which to snapshot pricing inputs.

## Quote contract

`quoteHospitalityBasePrice` consumes the same provider-independent stay scope used by availability: property, room type, rate plan, arrival, departure, and quantity. It requires `pricing:read`, active tenant inventory, and an active rate-plan assignment.

Every occupied night must be covered by exactly one active base-rate row in the organization's current currency. Missing or ambiguous nightly pricing fails closed. The quote returns:

- exact nightly minor-unit amounts
- stay nights and quantity
- accommodation subtotal in minor units
- currency
- a deterministic SHA-256 pricing fingerprint

The fingerprint is calculated from the effective nightly commercial values, currency, and quantity. It contains no secret values and is not treated as authorization.

## Revalidation and price changes

`revalidateHospitalityBasePrice` recalculates the latest quote from persisted pricing and compares its fingerprint with the previously presented value. A mismatch explicitly reports `changed: true` and returns the latest price. Browser-submitted totals are never accepted as authoritative.

The future booking-creation transaction must revalidate pricing again before permanent inventory confirmation. A displayed quote or browser redirect is never sufficient proof of the commercial amount to persist.

## Permissions and tenancy

- organization/platform admins and managers: `pricing:read`, `pricing:manage`
- staff: `pricing:read`
- customer-role organization memberships: no internal pricing access

All reads/writes validate organization membership and permission server-side. Resource identifiers are tenant/property scoped before database access.

## UI

`/pricing` is a real authenticated workspace route. It lists tenant properties and opens a property pricing screen where users select an active room-type/rate-plan assignment, review paginated historical/current base-rate windows, create non-overlapping rates, and archive active rates. Archived properties and users without manage permission receive read-only states.

The interface reuses the existing SF application shell, responsive inventory tables/cards, focus behavior, status messaging, validation states, and design tokens rather than introducing a second design system.

## Validation coverage

The standard unit command includes money and base-rate domain tests. The disposable PostgreSQL suite includes hospitality pricing coverage for exact minor-unit persistence, role enforcement, tenant denial, overlap rejection, multi-night/quantity quote totals, audit events, and changed-price revalidation.

Full repository validation still requires Node 24 and an explicitly disposable PostgreSQL target.

## Next dependencies

The next same-domain pricing work is taxes/fees, then add-ons and any real tenant/provider pricing rules. Once the complete price contract exists, booking creation can atomically revalidate price, convert/consume a hold (or directly allocate), and persist an immutable booking price snapshot without trusting the browser.
