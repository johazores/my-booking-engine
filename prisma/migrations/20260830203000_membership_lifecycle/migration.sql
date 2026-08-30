-- SF organization membership lifecycle foundation
-- ARCHIVED is a terminal audit-preserving state for memberships that should no
-- longer grant tenant access or be reactivated.

ALTER TYPE "MembershipStatus" ADD VALUE 'ARCHIVED';
