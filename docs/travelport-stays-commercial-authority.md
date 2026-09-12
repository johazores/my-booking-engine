# Travelport Stays commercial authority

## Purpose

Travelport SearchComplete and Rules responses contain values that SF turns into price, cancellation, guarantee, deposit, payment-card, and legal-text authority. Those normalized values contribute to offer fingerprints, Rules fingerprints, reservation review, and the disabled reservation write path. Provider compatibility parsing must therefore not silently trim, control-normalize, truncate, or discard malformed structures in distinct commercial evidence before it becomes SF authority.

This contract strengthens the existing read/review path only. It does not advertise Travelport `reservation`, add a customer/staff booking action, collect payment-card data, or relax any Phase 15 activation gate.

## Current provider model

Travelport's current JSON API model represents hotel offer pricing with currency plus base/tax/fee/total values and returns hotel `TermsAndConditionsFull` evidence that can include text, guarantees, cancellation penalties, accepted cards, deposit policy, and payment information. SF already normalizes those structures into provider-neutral booking terms and fingerprints the commercial result.

The public Travelport adapters now validate the authority-bearing parts of those successful responses before the compatibility cores can normalize them.

## Structural fail-closed rule

Optional commercial evidence may be absent or explicitly `null` where the compatibility layer already treats it as unavailable. Once an optional authority-bearing value is present, however, it must have the documented object/collection shape. A primitive or array cannot be reinterpreted as if the field were absent.

The active SearchComplete boundary applies that rule to rate `price`, rate `terms`, cancellation `penalty`, and penalty `currencyAmount` objects. The Rules boundary applies it to offer `Price`, nested `CurrencyCode`, and product `PropertyKey` objects. Present malformed structures fail with `INVALID_RESPONSE` before compatibility normalization or fingerprinting.

This mirrors the fail-closed structural rule already used by the disabled reservation-authority boundary while keeping the active read/review path independently protected.

## SearchComplete commercial boundary

Successful SearchComplete responses are checked before offer normalization for the fields that can enter price/offer fingerprints:

- base, tax, total, included-fee, and due-at-property money values;
- cancellation-penalty money values and canonical currency;
- room/rate descriptions used by the normalized offer;
- cancellation notes, deadlines, and short descriptions used by the normalized cancellation evidence;
- exact object shape for present price, terms, penalty, and penalty-currency evidence; and
- existing bounded room/rate collection limits.

Numeric money remains supported when it is finite and non-negative. A string money value is compatibility evidence and must already be exact: it cannot contain leading/trailing whitespace or ASCII controls `U+0000` through `U+001F` or `U+007F`.

Human-readable commercial text keeps the existing whitespace normalization behavior, but ASCII controls are rejected and text that would exceed the compatibility parser's retained bound is rejected instead of silently truncated. This prevents two different supplier terms from collapsing into the same offer fingerprint merely because their distinguishing text appears after SF's prior truncation boundary.

## Rules commercial boundary

Successful v11 Rules responses receive the same pre-normalization treatment before `TravelportStaysBookingTermsProvider` creates the durable terms fingerprint.

The guard covers:

- offer price base, taxes, fees, and total;
- canonical currency evidence;
- exact object shape for present offer price, currency-code, and product property-key evidence;
- payment-timing and guarantee machine tokens;
- cancellation amount, percent, nights, tax-subject, and description evidence;
- deposit currency and amount evidence;
- accepted payment-card codes;
- text-block language codes, titles, and formatted rule text; and
- bounded offer/product/terms/guarantee/cancellation/deposit/card/text traversal.

Machine tokens are exact bounded values. String money/decimal values cannot gain authority through trimming or embedded controls. Commercial free text may retain benign presentation whitespace normalization, but control-bearing or over-bound text fails closed rather than being truncated before fingerprinting.

The deposit-policy traversal is also bounded independently. A provider response cannot force unbounded iteration through a large array of empty deposit-policy containers that would otherwise evade the aggregate deposit-count limit.

## Why this is separate from display normalization

Hotel names and other presentation-only fields can still use their established display normalization. This boundary is narrower: it applies when provider data becomes commercial identity, price, terms, cancellation/deposit evidence, or a fingerprint input.

The compatibility cores remain isolated behind the public adapters. They can retain historical parsing behavior for now because successful production responses must cross the public authority guard first.

## Validation

Focused executable coverage verifies that:

- canonical SearchComplete and Rules fixtures remain accepted;
- padded/control-bearing SearchComplete money fails before price normalization;
- padded cancellation money and control-bearing/oversized commercial SearchComplete text fail closed;
- present malformed SearchComplete price, terms, penalty, and penalty-currency objects fail closed while absent/null optional structures remain compatible;
- padded/control-bearing Rules price, cancellation, and deposit values fail before terms fingerprinting;
- present malformed Rules price, currency-code, and property-key objects fail closed while absent/null optional structures remain compatible;
- padded/control-bearing Rules machine tokens such as language, payment timing, and guarantee type fail closed;
- Rules cancellation/text evidence that would previously be truncated is rejected; and
- oversized deposit-policy traversal is rejected before compatibility normalization.

A dependency-free structural authority contract pins every new fail-closed object boundary. The existing supplier-reference source contract continues to pin the public adapter calls into this commercial authority layer.

Full repository validation still requires the repository-supported Node 24.20+ / TypeScript 6 dependency environment. Live behavior still requires provisioned Travelport non-production credentials.

## Activation boundary

Travelport `reservation` remains deliberately unadvertised until all existing gates are complete:

1. a concrete reviewed PCI-safe FormOfPayment/guarantee source;
2. live non-production SearchComplete → Rules → Availability → initial Create → reviewed Create → Sync/recovery verification; and
3. authoritative live handling for `13034` and locator-less recovery semantics.

Related contracts:

- `docs/travelport-stays-reference-authority.md`
- `docs/travelport-terms-fingerprint-authority.md`
- `docs/travelport-reservation-authority-machine-evidence.md`
- `docs/travelport-stays-integration.md`
