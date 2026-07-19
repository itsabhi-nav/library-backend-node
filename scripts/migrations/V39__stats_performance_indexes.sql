-- Supporting indexes for the member-portal aggregations (leaderboard, SOTM,
-- progress, analytics). Every one of these scans daily_attendance_summary by
-- attendance_date and/or user_id. Idempotent.

CREATE INDEX IF NOT EXISTS idx_das_attendance_date
  ON daily_attendance_summary (attendance_date);

CREATE INDEX IF NOT EXISTS idx_das_user_date
  ON daily_attendance_summary (user_id, attendance_date);

CREATE INDEX IF NOT EXISTS idx_dsl_user_date
  ON daily_study_logs (user_id, log_date);

CREATE INDEX IF NOT EXISTS idx_user_achievements_user
  ON user_achievements (user_id);

CREATE INDEX IF NOT EXISTS idx_attendance_user_checkin
  ON attendance (user_id, check_in_time);
