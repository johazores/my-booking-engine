# Travelport Rules fingerprint authority

## Purpose

Travelport Rules observations carry both commercial reservation terms and observation metadata. SF uses the Rules fingerprint as durable sale authority, so the fingerprint must change when the terms change and must remain stable when only the observation time changes.

## Fingerprint contract

`fingerprintTravelportStaysBookingTerms` hashes normalized commercial authority only. It includes the selected property and offer references, exact price components, payment timing, guarantee types, loyalty and qualification requirements, accepted card codes, cancellation rules, deposit rules, check-in/out times, normalized provider text rules, and the reservation-review completeness decision.

`observedAt` and `revalidationRequired` are deliberately excluded. They describe when/how the evidence was obtained rather than what the supplier requires for the sale. A fresh Rules response with identical commercial terms therefore produces the same fingerprint even though it has a different observation timestamp.

Guarantee types and accepted card codes are treated as normalized sets for fingerprinting and are sorted before hashing. Ordered cancellation, deposit, and text-rule arrays remain ordered because their sequence can carry provider meaning.

Before normalization, the public Travelport response authority boundary now rejects normalization-confusable commercial evidence. Provider money/decimal machine values cannot gain authority through trimming or ASCII controls, and provider text that contributes to the fingerprint is rejected if controls or over-bound length would make the compatibility parser silently collapse/truncate distinct terms. This keeps the normalized fingerprint deterministic without allowing the normalization step itself to hide different supplier authority.

See `docs/travelport-stays-commercial-authority.md`.

## Submission behavior

The reservation authority provider still retrieves fresh Rules, performs final no-cache offer revalidation, and obtains selected-offer Availability authority immediately before the durable commercial-write claim. If any fingerprinted term changes, the fresh fingerprint differs from the prepared operation and submission fails closed for renewed review.

Previously prepared operations whose fingerprint was produced by the old timestamp-bound implementation are not guessed or backfilled. They will fail the exact terms-authority comparison and must be prepared again from current supplier evidence. This is intentional because SF cannot reconstruct old commercial authority from a hash.

This change does not enable Travelport `reservation`, expose a booking route/action, collect card data, or add `acceptPriceChangeInd` / `acceptGuaranteeChangeInd`. Those activation gates remain separate and require the reviewed PCI-safe form-of-payment strategy and live Travelport non-production validation.
