# Travelport reservation write outcome authority

## Purpose

Travelport Create, reviewed Create, and Booking.com Sync cross a durable external-write boundary. Once the provider-request marker has been written, the result returned by the provider executor can decide whether SF records confirmation, review-required state, definitive failure, recovery evidence, or an ambiguous outcome.

Those services must not keep reading a caller/provider-owned runtime object after provider I/O. A mutable object, accessor, or proxy could otherwise change status or locator/correlation evidence between observation, recovery-evidence persistence, and final settlement.

## Materialization contract

`materializeTravelportStaysReservationCreateOutcome` and `materializeTravelportStaysReservationSyncOutcome` copy only the fields valid for the returned branch into frozen SF-owned snapshots.

The boundary requires:

- an exact supported status;
- provider/supplier/recovery references and provider correlation IDs to be control-free, trim-stable operational tokens of at most 512 characters;
- Create validation failures to belong to the exact Travelport source-code set that the Create classifier treats as definitive no-sell validation evidence;
- the retryable bit for a definitive validation failure to match SF's existing ephemeral-payment retry classification rather than trusting an executor-supplied boolean as independent authority;
- review-required reasons to be one of `PRICE_CHANGED`, `GUARANTEE_CHANGED`, or `PRICE_AND_GUARANTEE_CHANGED`;
- ambiguous Create failures to be only `TRAVELPORT_SYNC_REQUIRED` or `INVALID_RESPONSE`;
- ambiguous Sync failures to be only `INVALID_RESPONSE`.

Each relevant property is read once. Irrelevant branch properties are not evaluated. Throwing accessors, revoked proxies, malformed branch shapes, unknown validation source codes, contradictory retryability, and caller-thrown provider errors are converted into one fixed `INVALID_RESPONSE` provider error without preserving caller-controlled exception text.

## Durable-write ordering

Initial Create and Booking.com Sync retain their existing fail-closed provider-request-marker fallback before the raw provider result is materialized. This is important: if an executor were to return without establishing the durable marker, SF must still treat the external write as potentially ambiguous rather than misclassifying a malformed result as a safe pre-provider failure.

Reviewed Create likewise preserves its existing requirement that the accepted-review request marker must exist before any returned provider result is trusted.

After marker continuity is established, a result that cannot be materialized is settled as `AMBIGUOUS / INVALID_RESPONSE`. No malformed result can authorize confirmation, reviewed retry, retryable failure, or recovery-reference persistence.

## Similar-issue sweep

The same runtime-result concern was reviewed across the connected Travelport write cluster:

- initial reservation Create;
- one-time reviewed Create;
- Booking.com Sync recovery write.

Known-locator read reconciliation is not duplicated here; it already uses the provider-result materialization boundary in the supplier reconciliation service. SearchComplete, Rules, and Availability commercial evidence are covered by the separate provider-result authority boundary.

## Activation boundary

Travelport `reservation` remains deliberately disabled. This hardening does not supply the concrete reviewed PCI-safe FormOfPayment/guarantee source, does not replace live non-production SearchComplete → Rules → Availability → initial Create → reviewed Create → Sync/recovery verification, and does not establish authoritative live `13034` or locator-less recovery semantics.

GitHub Actions are not used for validation.
