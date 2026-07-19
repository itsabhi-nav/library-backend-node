-- ============================================================
-- V28: Price moves onto shifts; catalog reset to 3 study shifts
-- ------------------------------------------------------------
-- The admin now manages ONLY shifts (Morning / Evening / Full Day), each with an
-- editable time window + monthly price. "Membership plans" become an internal
-- 1:1 backing record per shift so subscriptions / fee billing keep working
-- unchanged (subscriptions still reference membership_plans.id).
--
-- This migration:
--   1. adds shifts.price
--   2. retires the old shift/plan catalog (soft-disable, non-destructive)
--   3. (re)creates the 3 canonical shifts with default times + prices
--   4. ensures exactly one active backing plan per shift, priced from the shift
-- Idempotent + safe to re-run. Admin can edit times/prices from the UI afterward.
-- ============================================================

-- 1. Price on shifts
ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS price NUMERIC(10,2) NOT NULL DEFAULT 0;

-- 2. Retire the entire existing catalog so the UI starts clean
UPDATE membership_plans SET is_active = false;
UPDATE shifts SET is_active = false;

-- 3. (Re)create the three canonical shifts (defaults; admin editable)
INSERT INTO shifts (name, start_time, end_time, price, is_active)
SELECT v.name, v.s::time, v.e::time, v.p::numeric, true
FROM (VALUES
  ('Morning',  '07:00', '14:00', 400),
  ('Evening',  '14:00', '21:00', 400),
  ('Full Day', '07:00', '21:00', 1000)
) AS v(name, s, e, p)
WHERE NOT EXISTS (SELECT 1 FROM shifts x WHERE x.name = v.name);

-- If they already existed from a prior run, make sure they're active
UPDATE shifts SET is_active = true WHERE name IN ('Morning', 'Evening', 'Full Day');

-- 4. Ensure one backing plan per canonical shift, priced from the shift
INSERT INTO membership_plans (name, description, duration_days, price, shift_id, is_active)
SELECT s.name, 'Study shift', 30, s.price, s.id, true
FROM shifts s
WHERE s.name IN ('Morning', 'Evening', 'Full Day')
  AND NOT EXISTS (SELECT 1 FROM membership_plans p WHERE p.shift_id = s.id);

-- Keep existing backing plans in sync (name + price) and active
UPDATE membership_plans p
SET is_active = true, name = s.name, price = s.price, duration_days = 30
FROM shifts s
WHERE p.shift_id = s.id AND s.name IN ('Morning', 'Evening', 'Full Day');
