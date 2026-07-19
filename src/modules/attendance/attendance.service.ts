import { AppError } from "../../core/errors/AppError";
import { SimpleDatabase } from "../../core/database/SimpleDatabase";
import { evaluateAndAward } from "../achievements/achievements.service";
import { toIsoOrNull } from "../../shared/serializers";
import { istToday, istDateFromInstant, istMinutesOfDay } from "../../shared/ist";
import { parseTimeToMinutes, formatShiftTime12h } from "../../shared/shift-utils";
import { findByMemberId } from "../auth/auth.service";
import {
  notifyPunchInIfNeeded,
  notifyPunchOutIfNeeded,
} from "../whatsapp/attendance-notification.service";
import * as bookingRepo from "../booking/booking.repository";
import * as repo from "./attendance.repository";
import * as statsSvc from "./attendance-stats.service";
import { invalidateStudentOfMonthCache } from "../student-of-the-month/student-of-the-month.service";

function sessionDateFromCheckIn(checkInTime: Date): string {
  return istDateFromInstant(checkInTime);
}

export async function recordSessionCompletion(attendance: {
  check_in_time: Date;
  check_out_time: Date;
  user_id: number;
}) {
  if (!attendance.check_out_time || !attendance.check_in_time) return;

  const sessionDate = sessionDateFromCheckIn(new Date(attendance.check_in_time));
  let sessionMinutes = Math.floor(
    (new Date(attendance.check_out_time).getTime() - new Date(attendance.check_in_time).getTime()) / 60000
  );
  if (sessionMinutes < 0) sessionMinutes = 0;

  await SimpleDatabase.withTransaction(async (client) => {
    const existing = await repo.findDailySummary(Number(attendance.user_id), sessionDate, client);
    if (existing) {
      await repo.updateDailySummary(
        Number(existing.id),
        Number(existing.total_minutes) + sessionMinutes,
        new Date(attendance.check_out_time),
        client
      );
    } else {
      await repo.insertDailySummary(
        Number(attendance.user_id),
        sessionDate,
        sessionMinutes,
        new Date(attendance.check_out_time),
        client
      );
    }
  });

  // Attendance totals changed — drop the short-lived stats caches so the next
  // read recomputes fresh (keeps leaderboard/SOTM correct without losing the
  // read-burst benefit of caching).
  statsSvc.invalidateLeaderboardCache();
  invalidateStudentOfMonthCache();
}

async function loadUserWithSeat(userId: number) {
  const user = await repo.findUserById(userId);
  if (!user) return { user: null, seat: null };
  const seat =
    user.assigned_seat_id != null ? await repo.findSeatById(Number(user.assigned_seat_id)) : null;
  return { user, seat };
}

function toStatus(
  punchedIn: boolean,
  checkInTime: Date | null,
  seat: { id: number; seat_number: string } | null
) {
  return {
    punchedIn,
    checkInTime: checkInTime ? toIsoOrNull(checkInTime) : null,
    assignedSeatId: seat ? Number(seat.id) : null,
    seatNumber: seat ? seat.seat_number : null,
  };
}

/**
 * A member may punch in only during their subscribed shift window(s). If no shift
 * can be resolved (member has no active plan/shift), we don't block. Throws a
 * clear, user-facing error listing the allowed hours when outside the window.
 */
async function assertWithinShiftHours(userId: number): Promise<void> {
  const res = await SimpleDatabase.query(
    `SELECT s.start_time, s.end_time
       FROM subscriptions sub
       JOIN membership_plans mp ON mp.id = sub.plan_id
       JOIN shifts s ON s.id = mp.shift_id
      WHERE sub.user_id = $1 AND sub.status = 'ACTIVE'
        AND CURRENT_DATE BETWEEN sub.start_date AND sub.end_date
        AND s.is_active <> false`,
    [userId]
  );
  const windows = res.rows.filter((r: any) => r.start_time && r.end_time);
  if (windows.length === 0) return; // no shift to enforce

  const nowMin = istMinutesOfDay();
  const withinAny = windows.some((s: any) => {
    const start = parseTimeToMinutes(String(s.start_time));
    const end = parseTimeToMinutes(String(s.end_time));
    return nowMin >= start && nowMin < end;
  });
  if (withinAny) return;

  const label = windows
    .map(
      (s: any) =>
        `${formatShiftTime12h(String(s.start_time))} – ${formatShiftTime12h(String(s.end_time))}`
    )
    .join(" or ");
  throw AppError.badRequest(
    `You can punch in only during your shift hours: ${label}.`
  );
}

export async function checkIn(memberId: string) {
  const user = await findByMemberId(memberId);
  if (!user) throw AppError.badRequest(`User with member ID ${memberId} not found`);

  const active = await repo.findActiveAttendanceByUserId(Number(user.id));
  if (active) return loadAttendanceJson(active);

  await assertWithinShiftHours(Number(user.id));

  const booking = await repo.findActiveBookingsForUserOnDate(Number(user.id), istToday());
  const row = await repo.insertAttendance(Number(user.id), booking ? Number(booking.id) : null);
  void notifyPunchInIfNeeded(Number(user.id), new Date(row.check_in_time));
  return loadAttendanceJson(row);
}

export async function checkOut(memberId: string) {
  const user = await findByMemberId(memberId);
  if (!user) throw AppError.badRequest(`User with member ID ${memberId} not found`);

  const attendance = await repo.findActiveAttendanceByUserId(Number(user.id));
  if (!attendance) throw AppError.badRequest("User is not currently checked in");

  const saved = await repo.checkoutAttendance(Number(attendance.id));
  await recordSessionCompletion(saved);
  await evaluateAndAward(Number(user.id));
  void notifyPunchOutIfNeeded(
    Number(user.id),
    new Date(saved.check_in_time),
    new Date(saved.check_out_time)
  );
  return loadAttendanceJson(saved);
}

export async function punchInSelf(userId: number) {
  const { user, seat } = await loadUserWithSeat(userId);
  if (!user) throw AppError.badRequest("User not found");
  if (user.assigned_seat_id == null) {
    throw AppError.badRequest("No assigned seat. Contact admin to assign a seat before punching in.");
  }
  if (user.is_active !== true) throw AppError.badRequest("Account is deactivated.");

  const active = await repo.findActiveAttendanceByUserId(userId);
  if (active) {
    return toStatus(true, active.check_in_time, seat);
  }

  await assertWithinShiftHours(userId);

  const booking = await repo.findActiveBookingsForUserOnDate(userId, istToday());
  const saved = await repo.insertAttendance(userId, booking ? Number(booking.id) : null);
  void notifyPunchInIfNeeded(userId, new Date(saved.check_in_time));
  return toStatus(true, saved.check_in_time, seat);
}

export async function punchOutSelf(userId: number) {
  const { user, seat } = await loadUserWithSeat(userId);
  if (!user) throw AppError.badRequest("User not found");

  const attendance = await repo.findActiveAttendanceByUserId(userId);
  if (!attendance) throw AppError.badRequest("You are not punched in");

  const saved = await repo.checkoutAttendance(Number(attendance.id));
  await recordSessionCompletion(saved);
  const newAchievements = await evaluateAndAward(userId);
  void notifyPunchOutIfNeeded(
    userId,
    new Date(saved.check_in_time),
    new Date(saved.check_out_time)
  );

  return {
    punchedIn: false,
    assignedSeatId: seat ? Number(seat.id) : null,
    seatNumber: seat ? seat.seat_number : null,
    newAchievements: newAchievements.length > 0 ? newAchievements : null,
  };
}

/** Force punch-out when account is deactivated or shift ends. */
export async function punchOutUserIfActive(userId: number) {
  const attendance = await repo.findActiveAttendanceByUserId(userId);
  if (!attendance) return false;
  const saved = await repo.checkoutAttendance(Number(attendance.id));
  await recordSessionCompletion(saved);
  await evaluateAndAward(userId);
  void notifyPunchOutIfNeeded(
    userId,
    new Date(saved.check_in_time),
    new Date(saved.check_out_time)
  );
  return true;
}

export async function getMyStatus(userId: number) {
  const { user, seat } = await loadUserWithSeat(userId);
  if (!user) throw AppError.badRequest("User not found");

  const active = await repo.findActiveAttendanceByUserId(userId);
  if (active) return toStatus(true, active.check_in_time, seat);
  return toStatus(false, null, seat);
}

export async function getActiveSessions() {
  const rows = await repo.findAllActiveAttendances();
  return Promise.all(rows.map((r) => loadAttendanceJson(r)));
}

export async function getSeatIdsOccupiedByPunchIn() {
  return repo.findSeatIdsWithActivePunchIn();
}

/**
 * Live seat map. Deliberately shift-agnostic: a seat counts as occupied only
 * when a member is currently punched in there; every other seat reads as
 * available. (Time-overlap logic still governs seat *assignment* elsewhere.)
 * `shiftId` is accepted for backward-compatibility but no longer filters.
 */
export async function getSeatMapSnapshot(_shiftId: number | null) {
  const [seats, assignments, punchIns] = await Promise.all([
    bookingRepo.findAllSeats(),
    bookingRepo.findAllActiveSeatAssignments(),
    repo.findActivePunchInsWithDetails(),
  ]);

  const punchedInSeats = punchIns.map((p) => ({
    seatId: Number(p.seat_id),
    memberId: String(p.member_id),
  }));

  // Still surfaced (who a seat belongs to) but does NOT mark a seat occupied.
  const reservedSeats = assignments.map((a) => ({
    seatId: Number(a.seat_id),
    memberId: String(a.member_id),
  }));
  const reservedSeatIds = [...new Set(reservedSeats.map((r) => r.seatId))];

  const total = seats.length;
  const punchedIn = punchedInSeats.length;
  const available = Math.max(0, total - punchedIn);

  return {
    shiftId: null,
    stats: { total, available, reserved: reservedSeatIds.length, punchedIn },
    punchedInSeats,
    reservedSeats,
    reservedSeatIds,
  };
}

/**
 * Punch out everyone still punched in whose subscribed shift end time has already
 * passed (IST). One query resolves each punched-in member's shift, so it works
 * for any number of shifts and reflects live shift edits. Designed to run every
 * minute; using `<=` (not exact match) also recovers anyone missed during a brief
 * downtime.
 */
export async function autoPunchOutEndedShifts(): Promise<number> {
  const nowMin = istMinutesOfDay();
  const res = await SimpleDatabase.query(
    `SELECT a.id AS attendance_id, a.user_id, s.end_time
       FROM attendance a
       JOIN subscriptions sub ON sub.user_id = a.user_id AND sub.status = 'ACTIVE'
         AND CURRENT_DATE BETWEEN sub.start_date AND sub.end_date
       JOIN membership_plans mp ON mp.id = sub.plan_id
       JOIN shifts s ON s.id = mp.shift_id
      WHERE a.check_out_time IS NULL AND s.end_time IS NOT NULL`,
    []
  );

  let count = 0;
  for (const row of res.rows) {
    const endMin = parseTimeToMinutes(String(row.end_time));
    if (endMin > nowMin) continue;

    const saved = await repo.checkoutAttendance(Number(row.attendance_id));
    if (saved) {
      await recordSessionCompletion(saved);
      await evaluateAndAward(Number(row.user_id));
      void notifyPunchOutIfNeeded(
        Number(row.user_id),
        new Date(saved.check_in_time),
        new Date(saved.check_out_time)
      );
      count++;
    }
  }

  return count;
}

export async function getMonthlyStats(userId: number, year?: number | null, month?: number | null) {
  return statsSvc.getMonthlyStats(userId, year, month, repo);
}

export async function getLeaderboard(
  year: number | null | undefined,
  month: number | null | undefined,
  currentUserId: number
) {
  const ym = statsSvc.resolveYearMonth(year, month);
  return statsSvc.buildLeaderboard(ym.year, ym.month, currentUserId, repo);
}

async function loadAttendanceJson(row: any) {
  const { user, seat } = await loadUserWithSeat(Number(row.user_id));
  const { serializeAttendance } = await import("../../shared/serializers");
  return serializeAttendance(row, user, seat, null);
}
