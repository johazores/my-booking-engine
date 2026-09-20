# Rental hold release lifecycle

Rental availability hold release is an explicit staff lifecycle command. It must never report that inventory was released when the hold has already become immutable source evidence for a booking.

## Authority and tenancy

The release endpoint remains protected by the existing authenticated organization context, same-origin form mutation boundary, and `availability:manage` permission enforced by `releaseRentalAvailabilityHold`. Hold lookup and mutation remain scoped by both `organizationId` and `holdId`; a hold identifier never grants cross-tenant authority.

## Terminal outcomes

For an `ACTIVE` hold, the service uses PostgreSQL time as the expiry authority. A hold that is still inside its lifetime may transition to `RELEASED`; one whose `expiresAt` has already been reached transitions to `EXPIRED`. Repeating either terminal result is safe and the staff route may report the corresponding release/expiry outcome.

`CONSUMED` is different. It means the hold was converted into a durable rental booking and is retained booking source evidence. It is not a release result and must never be presented as `hold-released`. If booking confirmation wins a race with a staff release request, the compare-and-set release write leaves the consumed row untouched and the route returns a conflict rather than a false success.

Any other non-release lifecycle result also fails closed as a conflict. The caller must review current hold state instead of assuming inventory was released.

## Create/replay feedback after booking conversion

Hold creation has the same retained-evidence boundary. `createRentalAvailabilityHold` intentionally resolves an exact idempotent replay before fresh inventory authority, so retrying the original create command can return the historical hold after another request has already converted it into a booking.

The create-hold HTTP route therefore performs a fresh tenant-scoped database-clock state read after creation or replay. An effective `ACTIVE` hold may be reported as `hold-active`, while a released or time-expired historical replay may be reported as inactive. A persisted `CONSUMED` result is different: the route rejects it as a conflict instead of emitting a green `hold-inactive` success message. That prevents a stale create form or browser retry from hiding that booking conversion already owns the inventory evidence.

This check is deliberately at the HTTP outcome boundary. It does not mutate the consumed hold, reopen it, create another hold, cancel the booking, or weaken exact idempotent replay inside the service.

## Concurrency and booking evidence

Booking confirmation and hold release can race after a staff page has been rendered. Confirmation consumes the exact active hold while creating the booking and physical allocation atomically. Release updates only a row that is still `ACTIVE`. The release route therefore verifies the persisted lifecycle returned by the mutation before emitting a success redirect:

- `RELEASED` -> release success;
- `EXPIRED` -> expiry success;
- `CONSUMED` -> conflict because booking conversion won;
- any unexpected state -> conflict.

The existing database source-evidence guard keeps a consumed hold immutable once it backs a rental booking. This release boundary does not cancel a booking, mutate booking commercial evidence, move money, or create any customer-facing workflow.
