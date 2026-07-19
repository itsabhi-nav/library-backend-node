-- ============================================================
-- V27: Per-subscription discount + real library shift/plan catalog
-- ------------------------------------------------------------
-- 1. Adds a discount_percent column to subscriptions so an admin-applied
--    percentage discount persists and is re-applied on every monthly invoice
--    (not just the first one).
-- 2. Seeds the library's actual shift windows and monthly plans. Shifts store
--    real clock times, so the existing time-overlap seat-availability logic
--    handles these overlapping windows correctly (e.g. 7AM-2PM blocks 12PM-5PM).
-- 3. Retires the old generic demo shifts/plans (soft-disable, non-destructive —
--    historical subscriptions that reference them are untouched).
-- All statements are idempotent so the migration is safe to re-run.
-- ============================================================

-- --- 1. Discount column on subscriptions -------------------------------------
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0;

-- --- 2. Retire old demo catalog (safe: soft-disable only) --------------------
UPDATE membership_plans SET is_active = false
  WHERE name IN (
    '1 Month Basic (Single Shift)',
    '1 Month Premium (Full Day)',
    '3 Month Premium (Full Day)'
  );

UPDATE shifts SET is_active = false
  WHERE name IN ('Morning Shift', 'Evening Shift', 'Full Day Shift');

-- --- 3. Seed real shifts (idempotent by name) --------------------------------
INSERT INTO shifts (name, start_time, end_time, is_active)
SELECT v.name, v.start_time::time, v.end_time::time, true
FROM (VALUES
  ('Morning 7 AM-12 PM', '07:00', '12:00'),
  ('Morning 7 AM-2 PM',  '07:00', '14:00'),
  ('Afternoon 12-5 PM',  '12:00', '17:00'),
  ('Evening 2-9 PM',     '14:00', '21:00'),
  ('Evening 5-9 PM',     '17:00', '21:00'),
  ('Full Day 7 AM-4 PM', '07:00', '16:00'),
  ('Full Day 7 AM-7 PM', '07:00', '19:00'),
  ('Full Day 7 AM-9 PM', '07:00', '21:00')
) AS v(name, start_time, end_time)
WHERE NOT EXISTS (SELECT 1 FROM shifts s WHERE s.name = v.name);

-- --- 4. Seed monthly plans (idempotent by name), linked to the shift above ---
INSERT INTO membership_plans (name, description, duration_days, price, shift_id, is_active)
SELECT v.name, v.description, 30, v.price::numeric,
       (SELECT id FROM shifts s WHERE s.name = v.shift_name ORDER BY id LIMIT 1),
       true
FROM (VALUES
  ('Morning 7 AM-12 PM', 'Monthly seat - morning half',        300,  'Morning 7 AM-12 PM'),
  ('Morning 7 AM-2 PM',  'Monthly seat - extended morning',    400,  'Morning 7 AM-2 PM'),
  ('Afternoon 12-5 PM',  'Monthly seat - afternoon',           300,  'Afternoon 12-5 PM'),
  ('Evening 2-9 PM',     'Monthly seat - extended evening',    400,  'Evening 2-9 PM'),
  ('Evening 5-9 PM',     'Monthly seat - evening short',       200,  'Evening 5-9 PM'),
  ('Full Day 7 AM-4 PM', 'Monthly seat - full day (to 4 PM)',  600,  'Full Day 7 AM-4 PM'),
  ('Full Day 7 AM-7 PM', 'Monthly seat - full day (to 7 PM)',  800,  'Full Day 7 AM-7 PM'),
  ('Full Day 7 AM-9 PM', 'Monthly seat - full day (to 9 PM)',  1000, 'Full Day 7 AM-9 PM')
) AS v(name, description, price, shift_name)
WHERE NOT EXISTS (SELECT 1 FROM membership_plans p WHERE p.name = v.name);
