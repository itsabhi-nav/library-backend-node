-- ============================================================
-- V30: Shifts get a category (Morning / Evening / Full Day)
-- ------------------------------------------------------------
-- A shift now belongs to one of three fixed categories. The admin can add
-- MANY shifts under a category (each with its own time window + price), and the
-- UI groups them under the category header. Category is independent of the
-- time window — it's purely how the admin buckets the entries.
-- Idempotent + safe to re-run.
-- ============================================================

ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'MORNING';

-- Backfill the current canonical shifts
UPDATE shifts SET category = 'MORNING'  WHERE name = 'Morning';
UPDATE shifts SET category = 'EVENING'  WHERE name = 'Evening';
UPDATE shifts SET category = 'FULL_DAY' WHERE name = 'Full Day';
