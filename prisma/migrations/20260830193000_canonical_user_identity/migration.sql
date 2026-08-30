-- SF canonical user identity foundation
-- Existing non-canonical emails intentionally cause this migration to fail so
-- operators can review and remediate identity collisions before authentication.

ALTER TABLE "users"
ADD CONSTRAINT "users_email_canonical_check"
CHECK ("email" = lower(btrim("email")));

ALTER TABLE "users"
ADD CONSTRAINT "users_email_format_check"
CHECK ("email" ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$');
