# Rental ancillary manual evidence integrity

Damage settlement, late-return settlement, and security-bond reconciliation now reject retained manual references that are not canonical, including whitespace aliases and reserved internal claim references. Invalid database-authored transaction timestamps also fail closed; bond forfeiture timestamps are checked separately.

This is a read/reconciliation guard, not a historical data repair. Existing tenant and permission checks remain in the respective services. Node 24 and disposable PostgreSQL validation are still outstanding.
