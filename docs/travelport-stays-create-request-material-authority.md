# Travelport Stays Create Request Material Authority

## Purpose

Travelport Create request material is the last non-secret provider-specific composition boundary before SF can claim a durable external reservation write. It combines the freshly revalidated Availability sell reference, the already-authorized primary traveler, and the normalized payment/guarantee authority derived from current Rules evidence.

This material is intentionally narrower than the final Travelport Create payload. It contains no `FormOfPayment`, PAN, CVV/security code, cardholder data, billing-card data, OAuth token, integration secret, or other payment credential.

## Caller-owned input materialization

`buildTravelportStaysReservationCreateRequestMaterial` now treats its input objects as caller-owned authority rather than assuming that TypeScript types make runtime objects stable. Before provider reference validation or request mapping, it creates one-read snapshots of:

- the top-level provider submission reference, traveler, and payment authority;
- traveler first name, last name, email, and telephone authority;
- telephone country calling code, area code, and subscriber number;
- payment kind, collection timing, currency, exact minor-unit amount, and accepted-card collection; and
- each accepted-card code in the bounded collection.

The nested snapshots are frozen before the existing semantic validators consume them. This prevents getters, proxies, or later caller mutation from presenting one value during validation and another value during mapping. Accessor/proxy failures are converted to one fixed `INVALID_REQUEST` materialization error so caller-controlled exception text does not become application error output.

The snapshot layer does not make invalid values valid. Missing fields, malformed travelers, contradictory payment timing, invalid exact money, unsafe provider references, duplicate/empty/oversized accepted-card collections, and other semantic defects still fail through the existing provider request validators.

## Accepted-card machine authority

Travelport Rules documents `AcceptedCreditCard.value` as a two-character card code. SF now applies one exact provider-specific machine-token contract across the successful Rules response boundary, non-secret Create material, and the direct Create executor: two uppercase ASCII alphanumeric characters matching `[A-Z0-9]{2}`.

The provider-neutral `HospitalitySupplierReservationPaymentAuthority` deliberately keeps card-code syntax opaque and bounded so other suppliers do not inherit Travelport syntax. The Travelport adapter owns the stricter provider contract. As a result, a malformed two-character Rules value such as lowercase or punctuation fails before it can become commercial Create authority, and the request/executor boundaries independently repeat that requirement rather than trusting an upstream type.

## Persistence and sensitive-data boundary

Create request material is server-only and ephemeral. It must not be persisted, audited, logged, queued, placed in analytics, or returned to browser callers. The durable supplier reservation operation stores the normalized non-sensitive commercial evidence needed for authority/recovery, not this ephemeral sell reference or future card material.

The sensitive payment-card source remains a separate deferred capability. OAuth and non-sensitive transport validation happen before that source is invoked, and the final card material is validated only inside the Create executor immediately before the durable provider-request marker and commercial POST.

This hardening does not provide or imply a PCI-safe collection/token-vault implementation. Travelport `reservation` remains deliberately disabled until SF has a concrete reviewed PCI-safe FormOfPayment/guarantee source for the provisioned commercial account, live non-production end-to-end validation, and authoritative live handling for `13034` and locator-less recovery/correlation semantics.

## Related documentation

- `docs/supplier-reservation-submission-authority.md`
- `docs/travelport-reservation-create-coordinator.md`
- `docs/travelport-reservation-payment-card-boundary.md`
- `docs/travelport-stays-reservation-operation-input-authority.md`
