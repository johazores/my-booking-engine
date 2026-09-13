# Travelport Sync correlation authority

## Purpose

Travelport Booking.com Sync is a recovery write. Its outbound correlation identity is the already-persisted `RECOVERY_WRITE` attempt UUID, and that same value must survive unchanged through executor validation, `E2ETrackingID`, the v11 trace header, durable provider-request marking, and response-trace verification.

This boundary does not enable the Travelport `reservation` capability and does not change Sync eligibility or retry semantics.

## Canonical UUID grammar

The Sync executor accepts the same canonical SF correlation UUID grammar used by Travelport Create, the shared Stays trace transport, the reservation-only trace wrapper, and response trace verification:

`xxxxxxxx-xxxx-Vxxx-Wxxx-xxxxxxxxxxxx`

where `V` is UUID version `1` through `5` and `W` is one of `8`, `9`, `a`, or `b`.

The full variant group and final 12 hexadecimal digits are required. A truncated tail, missing separator, non-UUID value, or differently shaped identifier fails locally as `INVALID_REQUEST` before OAuth, the durable provider-request marker, or provider I/O.

This matters operationally because Sync receives a real attempt UUID from the durable reservation ledger. The executor must not reject a valid attempt identity because its local validator drifted from the validators used by the surrounding Travelport transport and response-correlation layers.

## Regression protection

A dependency-free source contract pins the canonical UUID grammar across:

- initial Create;
- Booking.com Sync;
- shared Travelport request tracing;
- reservation-only request/response trace authority; and
- payload response-trace verification.

The contract also explicitly rejects the previously unsafe truncated Sync grammar so a local copy cannot silently drift again while the rest of the trace stack continues to accept canonical attempt UUIDs.

The existing end-to-end pre-write Sync test remains the behavioral proof that a canonical attempt UUID reaches `E2ETrackingID` unchanged and that caller mutation after OAuth begins cannot replace it.

## Safety semantics

Correlation remains operational evidence only. A valid UUID does not prove that Booking.com sold the room, does not prove that Travelport created a PNR, does not authorize another recovery write, and does not change locator-less `AMBIGUOUS` handling.

After `providerRequestStartedAt` is written, timeout or response uncertainty remains non-retryable ambiguity until provider-specific truth establishes a safe outcome.

## Activation boundary

Travelport `reservation` remains deliberately unadvertised pending the concrete reviewed PCI-safe FormOfPayment/guarantee source, provisioned live non-production end-to-end verification, and authoritative live `13034` / locator-less correlation and retry semantics.

## References

- `docs/supplier-reservation-correlation.md`
- `docs/travelport-booking-sync-recovery-authority.md`
- `docs/travelport-reservation-response-trace-authority.md`
- `docs/travelport-stays-integration.md`
