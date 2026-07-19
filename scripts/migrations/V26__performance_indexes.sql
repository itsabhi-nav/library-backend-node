-- ============================================================
-- V26: Performance indexes for hot query paths
-- ------------------------------------------------------------
-- Postgres auto-indexes PRIMARY KEY / UNIQUE constraints but NOT foreign keys
-- or common filter columns. The queries that run on every page load (active
-- subscription lookup, seat map, bookings, attendance punch state) were doing
-- sequential scans. These indexes make them index lookups instead.
-- All are IF NOT EXISTS so the migration is safe to re-run.
-- ============================================================

-- --- subscriptions: active-subscription-for-user is the single most frequent read
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_active
  ON subscriptions(user_id, start_date, end_date)
  WHERE status = 'ACTIVE';
-- expiry / renewal crons scan by status + end_date
CREATE INDEX IF NOT EXISTS idx_subscriptions_status_end ON subscriptions(status, end_date);

-- --- bookings: (seat_id, shift_id, booking_date) is already unique-indexed
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(booking_date);
CREATE INDEX IF NOT EXISTS idx_bookings_subscription ON bookings(subscription_id);
CREATE INDEX IF NOT EXISTS idx_bookings_active_by_date
  ON bookings(booking_date)
  WHERE status = 'ACTIVE';

-- --- attendance: punch-in/out state and the live seat map
CREATE INDEX IF NOT EXISTS idx_attendance_user ON attendance(user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_booking ON attendance(booking_id);
-- "open" attendance rows (not yet checked out) drive current-occupancy queries
CREATE INDEX IF NOT EXISTS idx_attendance_open
  ON attendance(user_id)
  WHERE check_out_time IS NULL;

-- --- users: seat assignment lookups + role/active filters
CREATE INDEX IF NOT EXISTS idx_users_assigned_seat
  ON users(assigned_seat_id)
  WHERE assigned_seat_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_role_active ON users(role, is_active);

-- --- fee invoices: member fee history ("/fees/my") filters by user_id + status
CREATE INDEX IF NOT EXISTS idx_fee_invoices_user_status ON fee_invoices(user_id, status);
