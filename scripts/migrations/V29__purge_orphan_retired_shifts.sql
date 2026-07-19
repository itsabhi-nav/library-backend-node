-- ============================================================
-- V29: Purge retired shifts/plans that nothing depends on
-- ------------------------------------------------------------
-- V28 soft-disabled the old demo catalog, which left a long list of "Inactive"
-- shifts cluttering the admin view. This permanently removes the ones that are
-- safe to delete (no subscription references a plan, no booking references the
-- shift). Anything still referenced by an existing member is kept intact.
-- Idempotent + safe to re-run.
-- ============================================================

-- Drop inactive backing plans that no subscription points at
DELETE FROM membership_plans mp
WHERE mp.is_active = false
  AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.plan_id = mp.id);

-- Drop inactive shifts that now have no plans and no bookings
DELETE FROM shifts sh
WHERE sh.is_active = false
  AND NOT EXISTS (SELECT 1 FROM membership_plans mp WHERE mp.shift_id = sh.id)
  AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.shift_id = sh.id);
