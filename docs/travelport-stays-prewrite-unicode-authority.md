# Travelport Stays pre-write Unicode authority

## Purpose

Travelport SearchComplete, Rules, and Availability JSON becomes reservation-review and supplier-write authority inside SF. JavaScript permits lone UTF-16 surrogate code units inside otherwise parseable JSON strings, but those values are not valid Unicode scalar-value sequences and can fail or change behavior when later serialized into URLs, headers, provider requests, fingerprints, or durable supplier evidence.

SF therefore rejects ill-formed Unicode before the current Travelport Stays pre-write authority chain can consume it. This is provider-specific hardening only: it does not advertise or enable the `reservation` capability and it does not change Travelport commercial semantics.

## Boundary

`createTravelportStaysPreWriteUnicodeAuthorityFetch` applies only to the fixed Travelport Stays API hosts and the current pre-write JSON routes:

- v12 SearchComplete;
- v11 Rules `buildfromrequest`; and
- v11 Availability, including continuation pages.

For materialized JSON request bodies, every JSON string value and object key must be a well-formed Unicode scalar-value sequence before delegated provider I/O. An escaped lone high or low surrogate therefore fails locally as `INVALID_REQUEST`.

For successful JSON responses, the same rule runs before the existing reference, commercial-member, selection, pagination, or reservation-authority parser is allowed to consume the payload. Ill-formed response JSON strings or keys fail as `INVALID_RESPONSE`.

Non-success provider responses are not promoted into pre-write authority by this guard; the existing status/failure classifiers retain ownership of those responses. Invalid JSON remains owned by the existing route-specific response validators. Non-Travelport and unrelated Travelport routes pass through unchanged.

## Composition

The Rules path composes the Unicode guard closest to the provider transport, before the existing reference/member/selection response guards consume successful provider JSON.

The reservation-authority path uses the same Unicode guard beneath the existing SearchComplete/Availability response authority and Availability selection authority. This means the fresh SearchComplete -> Rules -> Availability chain now has one consistent Unicode scalar-value invariant without duplicating string checks across every current or future provider member.

The guard intentionally preserves well-formed non-BMP characters. Existing field-specific contracts still decide whether a particular field is allowed, bounded, canonical, or ASCII-only.

## Similar-issue sweep

The current pre-write Travelport Stays wrappers were reviewed together because Rules is constructed by the booking-terms provider while SearchComplete and Availability are constructed by the reservation-authority provider. Both now compose the same boundary rather than maintaining separate surrogate checks.

Existing reservation write/recovery request and structured-response Unicode guards remain independent defense-in-depth boundaries because they operate on materially different Create, Sync, Retrieve, locator, traveler, and payment-card evidence.

## Validation

Focused behavior coverage verifies that:

- escaped lone surrogates in SearchComplete, Rules, or Availability request JSON fail before provider I/O;
- ill-formed strings and object keys in successful provider JSON fail before downstream authority parsing;
- well-formed non-BMP request and response text remains accepted;
- unrelated routes and non-success provider responses are not reclassified by this guard; and
- both public pre-write provider wrappers compose the shared guard closest to provider transport.

Full repository validation still requires the repository-supported Node 24.20+ / TypeScript 6 dependency environment. Live Travelport verification remains blocked on provisioned non-production credentials and the existing Phase 15 activation gates.

## Activation boundary

Travelport `reservation` remains deliberately unadvertised pending:

1. a concrete reviewed PCI-safe FormOfPayment/guarantee source;
2. live non-production SearchComplete -> Rules -> Availability -> initial Create -> reviewed Create -> Sync/recovery verification; and
3. authoritative live `13034` / locator-less correlation and retry/recovery semantics.

See also `docs/travelport-reservation-unicode-authority.md`, `docs/travelport-stays-integration.md`, and `docs/gds-integration.md`.
