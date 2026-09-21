# Invoice number sequence integrity

## Purpose

`HospitalityInvoiceNumberSequence` is legal-document infrastructure, not an editable counter. A rewind, skip, key rewrite, detached counter, or document number that disagrees with its sequence can make fiscal numbering ambiguous even when an individual issued document remains immutable.

## Database authority

PostgreSQL now owns the integrity boundary for the supported `TAX_INVOICE` and `ADJUSTMENT_NOTE` ledgers.

- sequence identity (`organizationId`, `jurisdictionCode`, `documentType`) cannot be rewritten;
- an update may advance `nextValue` by exactly one only;
- the deferred end-of-transaction invariant requires numbering to start at `1`, remain contiguous, and leave `nextValue` exactly one greater than the highest issued value;
- every issued tax invoice and adjustment note must have its matching sequence row;
- every document number is derived exactly from its sequence value: `AU-TAX-` plus the sequence padded to at least eight digits for tax invoices and `AU-ADJ-` plus the same padding rule for adjustment notes;
- sequence values are positive, and the two legal-document tables are constrained to their canonical document types;
- insert/delete checks are deferred so the production issuance transaction can advance the counter and insert its immutable document atomically, while incomplete counter-only or document-only writes fail at commit.

This is intentionally transaction-level rather than browser or service convention. A failed issuance rolls the counter increment back with the document write. A direct SQL counter increment without a matching legal document is rejected when the transaction commits, and a direct insert cannot pair a valid sequence value with a different legal document number.

The sequence-integrity migration uses a dedicated supported-document-type constraint name instead of reusing the broader constraint created by the original invoice foundation. This keeps the complete checked-in migration chain valid while adding the narrower production rule.

## Deletion and maintenance

Deleting a sequence while issued documents remain is rejected by the same deferred history invariant. Controlled fixture or maintenance teardown must remove the complete matching issued-document ledger and sequence in one transaction. Product workflows do not expose sequence reset or fiscal-number reuse.

## Validation

`src/server/payments/hospitality-invoice-number-sequence-integrity.integration.ts` covers invalid initialization, skip attempts, identity rewrites, and unmatched single-step advancement on a disposable PostgreSQL database. Existing invoice issuance integration coverage exercises the valid path where sequence advancement and legal-document insertion commit together and proves a used sequence cannot be removed independently.

`scripts/hospitality-invoice-number-sequence-integrity-source-contract.test.mjs` provides dependency-free coverage for the migration, migration-chain constraint-name compatibility, exact document-number/sequence identity, database-test registration, regression shape, and this documentation. Live migration/integration execution still requires the repository-supported Node and disposable PostgreSQL environment.
