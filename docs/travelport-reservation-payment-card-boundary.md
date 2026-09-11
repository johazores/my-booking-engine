# Travelport Reservation Payment-Card Boundary

## Purpose

SF keeps Travelport reservation writes server-only and disabled while the production PCI/FormOfPayment gate is unresolved. The internal `TravelportStaysReservationPaymentCardSource` is a narrow capability contract for obtaining one ephemeral card after tenant-scoped commercial authority and Travelport authentication have succeeded. It is not a vault, collection route, hosted-field integration, persistence model, or proof that SF is PCI-ready.

## Execution-context authority

The source receives only organization, reservation, integration, attempt, credential-version, and fixed-purpose authority. Organization, reservation, integration, and attempt IDs must be canonical UUIDs. The integration credential version must be a positive safe integer no greater than `2,147,483,647`, matching the durable Prisma/PostgreSQL `Int` range rather than accepting JavaScript-only numeric values that cannot represent persisted integration authority.

## Failure sanitization and retry authority

A future PCI-reviewed source is external to the Travelport adapter and can fail with implementation-specific exceptions. Those exceptions are not trusted diagnostic authority: a vault or SDK error can include sensitive or provider-owned data that must not propagate through ordinary application errors.

SF therefore snapshots the source capability function before invocation and replaces source-controlled exception text with a fixed generic message before the error can reach pre-provider settlement or a caller. A source may deliberately throw a typed `HospitalitySupplierProviderError`; SF preserves only its normalized failure code and derives retryability from the provider-neutral error contract while replacing the message. Untyped failures become non-retryable `INVALID_REQUEST`.

The source result still remains ephemeral and is passed directly to the Travelport Create adapter for provider-specific validation. Fresh accepted-card authority, card shape, expiry-through-stay, billing-address, and payment-telephone checks remain adapter-owned and execute before the durable provider-request marker.

## Regression correction

The Create executor regression fixture had retained the obsolete direct `paymentCard` execution input after production orchestration moved to deferred `acquirePaymentCard`. That stale fixture no longer represented the actual server contract and could not validate the intended secret-lifetime ordering. The fixture now uses the deferred callback throughout and asserts the real OAuth → card acquisition → durable marker → commercial POST sequence, including the rule that invalid card material is acquired only after successful OAuth and still fails before the commercial provider request.

## Activation boundary

Travelport `reservation` remains deliberately disabled. This hardening does not provide a concrete production payment-card source and does not close the remaining activation gates. Production activation still requires a separately reviewed PCI-safe FormOfPayment/guarantee source for the provisioned Travelport account, live non-production SearchComplete → Rules → Availability → initial Create → reviewed Create → Sync/recovery verification, and authoritative live `13034` / locator-less recovery semantics.

No payment-card plaintext, source diagnostics, provider credentials, access tokens, or raw provider payloads belong in Prisma, audit metadata, logs, analytics, queues, or request fingerprints.
