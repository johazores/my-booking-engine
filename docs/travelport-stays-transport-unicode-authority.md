# Travelport Stays transport Unicode authority

## Purpose

Travelport credentials, OAuth bearer tokens, SearchComplete pagination identifiers, supplier rate identifiers, booking codes, and other machine values cross URL, header, cache, and provider-normalization boundaries. JavaScript strings can contain lone UTF-16 surrogate code units even though they are not valid Unicode scalar-value sequences. Those values can later fail URL serialization, be replaced during UTF-8 transport, or compare differently after another system normalizes them.

SF therefore treats well-formed Unicode as part of exact transport authority. This strengthens the active Travelport SearchComplete/pricing transport, integration authentication/health boundary, and existing reservation foundation. It does not advertise Travelport `reservation` or relax any Phase 15 activation gate.

## Exact transport rule

The public Travelport provider boundary now requires every credential and machine token that it authorizes to be:

- a string when present;
- non-empty where the field is required;
- within the existing field-specific length limit;
- a well-formed Unicode scalar-value sequence with no lone high or low surrogate code unit;
- already exact, with no leading or trailing whitespace that would be normalized away; and
- free of ASCII controls `U+0000` through `U+001F` and `U+007F`.

Well-formed non-BMP text is not rejected merely because it uses a surrogate pair. This is a scalar-value exactness rule, not an ASCII-only alphabet restriction; existing field-specific grammars remain responsible for narrower identifiers where the provider contract requires them.

Optional machine evidence may remain absent or explicitly `null` where the existing provider contract already treats it as unavailable. Once such evidence is present, however, it must be a string. Numeric, boolean, object, and array values cannot silently bypass the public guard and reach compatibility parsing as if the field were absent.

## Covered boundaries

The shared public Travelport transport guard applies this invariant to:

- configured username, password, client ID, client secret, and access group before compatibility normalization;
- successful OAuth `access_token` evidence before it can enter token cache or an Authorization header;
- SearchComplete pagination identifiers returned by Travelport;
- caller-supplied pagination replay identifiers before `encodeURIComponent` or provider I/O;
- SearchComplete property/rate machine evidence already traversed by the public response guard, including chain/property codes, rate keys, booking codes, and rate-code metadata;
- Rules machine evidence already traversed by the same public response guard; and
- decoded Travelport offer `rateValue` authority before pricing/revalidation provider I/O.

A lone surrogate on request authority fails as `INVALID_REQUEST` before delegated provider I/O. A lone surrogate or wrong primitive type in successful provider machine evidence fails as `INVALID_RESPONSE` before compatibility normalization, caching, URL/header reuse, or normalized supplier authority can consume it.

## Similar-issue sweep

The reservation write path already has two independent protections for the same underlying concern:

- the provider-neutral supplier reservation machine-token boundary requires `String.prototype.isWellFormed()`; and
- the Travelport pre-write JSON Unicode boundary recursively rejects lone surrogate string values and object keys before SearchComplete, Rules, or Availability evidence becomes reservation authority.

Those paths therefore do not need a duplicate transport-only validator in this change. The public Travelport provider still owns the transport credential/token rule because OAuth, advertised SearchComplete pagination, and pricing reads exist outside the reservation-only JSON guard.

Presentation-only hotel names remain outside this narrow transport-token contract. Commercial text and fingerprints keep their separate authority contracts; this change does not turn arbitrary display text into a machine token.

## Validation

Focused behavior coverage verifies that:

- each Travelport credential field rejects a lone surrogate before core normalization;
- a successful OAuth response cannot cache or reuse an ill-formed access token;
- SearchComplete rate machine evidence containing a lone surrogate fails as `INVALID_RESPONSE`;
- a valid paired non-BMP SearchComplete machine token remains accepted by this transport Unicode guard;
- present non-string SearchComplete machine evidence fails instead of being ignored as absent; and
- a lone-surrogate pagination replay token fails as `INVALID_REQUEST` before any OAuth or provider request.

A dependency-free source contract pins the scalar-value checks and confirms the existing reservation machine-token and pre-write JSON Unicode guards already cover their corresponding boundaries.

Full repository validation still requires the repository-supported Node 24.20+ / TypeScript 6 dependency environment. Live provider validation still requires provisioned Travelport non-production credentials.

## Activation boundary

Travelport `reservation` remains deliberately unadvertised until the existing gates are complete:

1. a concrete reviewed PCI-safe FormOfPayment/guarantee source;
2. live non-production SearchComplete → Rules → Availability → initial Create → reviewed Create → Sync/recovery verification; and
3. authoritative live handling for `13034` and locator-less recovery semantics.

Related contracts:

- `docs/travelport-stays-transport-token-authority.md`
- `docs/travelport-stays-prewrite-unicode-authority.md`
- `docs/supplier-reservation-machine-token-authority.md`
- `docs/travelport-stays-reference-authority.md`
- `docs/travelport-stays-integration.md`
