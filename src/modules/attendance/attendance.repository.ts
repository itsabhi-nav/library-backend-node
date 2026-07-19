import { PoolClient } from "pg";
import { SimpleDatabase } from "../../core/database/SimpleDatabase";
import { USER_COLUMNS, SEAT_COLUMNS } from "../auth/auth.repository";
import { BOOKING_COLUMNS } from "../booking/booking.repository";
import { istToday } from "../../shared/ist";

const ATT_COLUMNS = `id, user_id, booking_id, check_in_time, check_out_time, created_at`;

type Runner = Pick<typeof SimpleDatabase, "query"> | PoolClient;

function run(runner: Runner | undefined, text: string, params: any[]) {
  if (runner && runner !== (SimpleDatabase as unknown)) {
    return (runner as PoolClient).query(text, params);
  }
  return SimpleDatabase.query(text, params);
}

export async function findActiveAttendanceByUserId(userId: number) {
  const res = await SimpleDatabase.query(
    `SELECT ${ATT_COLUMNS} FROM attendance WHERE user_id = $1 AND check_out_time IS NULL LIMIT 1`,
    [userId]
  );
  return res.rows[0] ?? null;
}

export async function findAllActiveAttendances() {
  const res = await SimpleDatabase.query(
    `SELECT ${ATT_COLUMNS} FROM attendance WHERE check_out_time IS NULL ORDER BY check_in_time`,
    []
  );
  return res.rows;
}

export async function findSeatIdsWithActivePunchIn() {
  const res = await SimpleDatabase.query(
    `SELECT DISTINCT u.assigned_seat_id AS seat_id
     FROM attendance a
     JOIN users u ON u.id = a.user_id
     WHERE a.check_out_time IS NULL AND u.assigned_seat_id IS NOT NULL`,
    []
  );
  return res.rows.map((r) => Number(r.seat_id));
}

export async function findActivePunchInsWithDetails() {
  const today = istToday();
  const res = await SimpleDatabase.query(
    `SELECT u.assigned_seat_id AS seat_id, u.member_id,
            s.start_time, s.end_time
     FROM attendance a
     JOIN users u ON u.id = a.user_id
     LEFT JOIN subscriptions sub ON sub.user_id = u.id AND sub.status = 'ACTIVE'
       AND $1::date BETWEEN sub.start_date AND sub.end_date
     LEFT JOIN membership_plans mp ON mp.id = sub.plan_id
     LEFT JOIN shifts s ON s.id = mp.shift_id
     WHERE a.check_out_time IS NULL AND u.assigned_seat_id IS NOT NULL`,
    [today]
  );
  return res.rows;
}

export async function insertAttendance(userId: number, bookingId: number | null, runner?: Runner) {
  const res = await run(
    runner,
    `INSERT INTO attendance (user_id, booking_id, check_in_time)
     VALUES ($1, $2, NOW()) RETURNING ${ATT_COLUMNS}`,
    [userId, bookingId]
  );
  return res.rows[0];
}

export async function checkoutAttendance(id: number, runner?: Runner) {
  const res = await run(
    runner,
    `UPDATE attendance SET check_out_time = NOW() WHERE id = $1 RETURNING ${ATT_COLUMNS}`,
    [id]
  );
  return res.rows[0] ?? null;
}

export async function findUserById(userId: number) {
  const res = await SimpleDatabase.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [userId]);
  return res.rows[0] ?? null;
}

export async function findSeatById(seatId: number) {
  const res = await SimpleDatabase.query(`SELECT ${SEAT_COLUMNS} FROM seats WHERE id = $1`, [seatId]);
  return res.rows[0] ?? null;
}

export async function findActiveBookingsForUserOnDate(userId: number, date: string) {
  const res = await SimpleDatabase.query(
    `SELECT ${BOOKING_COLUMNS} FROM bookings
     WHERE user_id = $1 AND booking_date = $2 AND status = 'ACTIVE' ORDER BY id LIMIT 1`,
    [userId, date]
  );
  return res.rows[0] ?? null;
}

// ---- daily attendance summary ----

export async function findDailySummary(userId: number, date: string, runner?: Runner) {
  const res = await run(
    runner,
    `SELECT id, user_id, attendance_date, total_minutes, last_punch_out_time
     FROM daily_attendance_summary
     WHERE user_id = $1 AND attendance_date = $2 LIMIT 1`,
    [userId, date]
  );
  return res.rows[0] ?? null;
}

export async function insertDailySummary(
  userId: number,
  date: string,
  totalMinutes: number,
  lastPunchOut: Date,
  runner?: Runner
) {
  const res = await run(
    runner,
    `INSERT INTO daily_attendance_summary (user_id, attendance_date, total_minutes, last_punch_out_time)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [userId, date, totalMinutes, lastPunchOut]
  );
  return res.rows[0];
}

export async function updateDailySummary(
  id: number,
  totalMinutes: number,
  lastPunchOut: Date,
  runner?: Runner
) {
  await run(
    runner,
    `UPDATE daily_attendance_summary SET total_minutes = $2, last_punch_out_time = $3 WHERE id = $1`,
    [id, totalMinutes, lastPunchOut]
  );
}

export async function sumMinutesForUserInRange(userId: number, start: string, end: string) {
  const res = await SimpleDatabase.query(
    `SELECT COALESCE(SUM(total_minutes), 0)::bigint AS total
     FROM daily_attendance_summary
     WHERE user_id = $1 AND attendance_date >= $2 AND attendance_date <= $3`,
    [userId, start, end]
  );
  return Number(res.rows[0]?.total ?? 0);
}

export async function countPresentDaysForUserInRange(userId: number, start: string, end: string) {
  const res = await SimpleDatabase.query(
    `SELECT COUNT(*)::int AS cnt FROM daily_attendance_summary
     WHERE user_id = $1 AND attendance_date >= $2 AND attendance_date <= $3 AND total_minutes > 0`,
    [userId, start, end]
  );
  return Number(res.rows[0]?.cnt ?? 0);
}

export async function aggregateMinutesByUserInRange(start: string, end: string) {
  const res = await SimpleDatabase.query(
    `SELECT user_id, COALESCE(SUM(total_minutes), 0)::bigint AS minutes,
            COUNT(CASE WHEN total_minutes > 0 THEN 1 END)::bigint AS days
     FROM daily_attendance_summary
     WHERE attendance_date >= $1 AND attendance_date <= $2
     GROUP BY user_id`,
    [start, end]
  );
  return res.rows;
}

export async function findAllMembers() {
  const res = await SimpleDatabase.query(
    `SELECT ${USER_COLUMNS} FROM users WHERE role = 'MEMBER' AND is_active = true ORDER BY id`,
    []
  );
  return res.rows;
}

export { ATT_COLUMNS };
