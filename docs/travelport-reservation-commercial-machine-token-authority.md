# Travelport reservation commercial machine-token authority

## Purpose

Travelport reservation creation and recovery cross a commercial provider boundary. Provider-owned identifiers, accepted-card capability codes, supplier confirmation references, and correlation values can influence whether SF is allowed to submit or interpret a reservation write. Those values are machine evidence, not display text, and must never become valid merely because SF trimmed or ignored control characters.

This hardening does not enable Travelport reservation capability. It strengthens the already-disabled production path while the existing activation gates remain open.

## Exact machine-token rule

The current reservation write path rejects ASCII control characters `U+0000` through `U+001F` plus `U+007F` from the following same-scope authority surfaces:

- bounded Travelport reservation response correlation evidence;
- normalized accepted-payment-card capability codes used to derive reservation payment authority;
- the selected provider submission reference used in Create request material;
- accepted-card codes revalidated again immediately before Create request composition; and
- the durable supplier confirmation reference used to construct Booking.com Sync recovery.

Where a token must already be canonical, leading or trailing whitespace is rejected rather than trimmed into authority. Duplicate accepted-card codes also remain invalid.

The shared payment-authority boundary intentionally treats accepted-card codes as exact normalized capability evidence. It no longer changes a supplied code such as `" VI"` into `"VI"`. Outbound Create independently repeats the exact-token and control-character checks so malformed commercial authority cannot cross the provider-request boundary even if an upstream caller is incorrectly constructed.

## Human and sensitive data remain separate

This rule is deliberately scoped to machine evidence. It does not change user-facing free text normalization and it does not add, persist, log, or expose payment-card secrets. The existing FormOfPayment contract remains a separately reviewed PCI boundary.

No PAN, CVV, cardholder secret, bearer token, credential, provider body, or supplier confirmation value is added to application logs or audit payloads by this change.

## Recovery and correlation behavior

Booking.com Sync is a commercial recovery write. The durable supplier confirmation inserted into its provider request must therefore remain exact and control-free before request composition.

Travelport response correlation is operational evidence. When an SF request correlation UUID is expected, the exact echoed value remains mandatory. When the helper is used without an expected SF correlation for bounded classifier/fixture compatibility, a provider correlation is still rejected if it contains any ASCII control character instead of only CR/LF.

## Validation

Focused regression coverage pins:

- exact accepted-card capability codes and rejection of padded, duplicate, oversized, newline, tab, NUL, unit-separator, and DEL forms;
- rejection of control-bearing outbound Create offer/card tokens;
- rejection of control-bearing Sync supplier confirmations; and
- rejection of every ASCII control family from optional provider response correlation evidence.

A dependency-free source contract also pins the full-control pattern and ensures the shared payment-authority boundary does not reintroduce card-code trimming.

Full repository validation still requires the repository-supported Node 24 / TypeScript 6 dependency environment. Prisma/PostgreSQL scenarios require an explicitly disposable target. Live Travelport reservation verification requires provisioned non-production credentials and the separately reviewed PCI-safe payment/guarantee source.

## Activation boundary

Travelport `reservation` remains deliberately unadvertised. This hardening does not satisfy the remaining Phase 15 gates:

1. provision and review a concrete PCI-safe FormOfPayment/guarantee source;
2. complete live non-production SearchComplete → Rules → Availability → initial Create → reviewed second Create → Sync/recovery verification; and
3. establish authoritative live handling for `13034` and locator-less recovery semantics.

Related contracts:

- `docs/travelport-stays-integration.md`
- `docs/travelport-reservation-response-trace-authority.md`
- `docs/travelport-stays-receipt-token-authority.md`
- `docs/travelport-known-locator-machine-token-authority.md`
- `docs/travelport-reservation-create-coordinator.md`
