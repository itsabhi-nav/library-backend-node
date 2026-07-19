import { SimpleDatabase } from "../../core/database/SimpleDatabase";
import { getUserMetrics } from "../../shared/userMetrics";
import { istYear, istMonth, monthStart, monthEnd, minutesToHours, istToday, istDayOfMonth, daysInMonth } from "../../shared/ist";
import * as repo from "./achievements.repository";

const EARLY_BIRD_MINUTES = 600;
const NIGHT_OWL_MINUTES = 1140;

function toUnlocked(row: any) {
  return {
    code: row.code,
    title: row.title,
    description: row.description,
    category: row.category,
    iconKey: row.icon_key,
    earnedAt: row.earned_at ? new Date(row.earned_at).toISOString() : null,
  };
}

function computeProgressPercent(def: any, currentValue: number): number {
  if (def.threshold_unit === "TIME_BEFORE" || def.threshold_unit === "TIME_AFTER") {
    return currentValue > 0 ? 100 : 0;
  }
  if (def.threshold_unit === "RANK_POSITION") {
    if (currentValue >= 999) return 0;
    if (currentValue <= def.threshold_value) return 100;
    return Math.max(0, Math.min(100, Math.round(((def.threshold_value + 10 - currentValue) * 100) / 10)));
  }
  if (def.threshold_value <= 0) return 0;
  return Math.min(100, Math.round((currentValue * 100) / def.threshold_value));
}

async function getMonthRank(userId: number, year: number, month: number): Promise<number | null> {
  const start = monthStart(year, month);
  const end = monthEnd(year, month);
  const res = await SimpleDatabase.query(
    `WITH ranked AS (
       SELECT user_id, ROW_NUMBER() OVER (ORDER BY COALESCE(SUM(total_minutes), 0) DESC) AS rk
       FROM daily_attendance_summary
       WHERE attendance_date >= $1 AND attendance_date <= $2
       GROUP BY user_id
     )
     SELECT rk FROM ranked WHERE user_id = $3`,
    [start, end, userId]
  );
  if (res.rows.length === 0) return null;
  return Number(res.rows[0].rk);
}

async function currentValueForDefinition(userId: number, def: any, metrics: Awaited<ReturnType<typeof getUserMetrics>>, monthRank?: number | null) {
  switch (def.threshold_unit) {
    case "STREAK_DAYS":
      return Math.max(metrics.currentStreak, metrics.longestStreak);
    case "MINUTES":
      return Math.min(metrics.lifetimeMinutes, Number.MAX_SAFE_INTEGER);
    case "DAYS":
      return metrics.lifetimeDaysPresent;
    case "MONTH_MINUTES":
      return metrics.monthMinutes;
    case "MONTH_DAYS":
      return metrics.monthDaysPresent;
    case "RANK_POSITION":
      return monthRank != null && monthRank > 0 ? monthRank : 999;
    case "DAY_MAX_MINUTES":
      return await repo.getMaxSingleDayMinutes(userId);
    case "MONTH_WEEKEND_DAYS": {
      const year = istYear();
      const month = istMonth();
      return await repo.getMonthWeekendDaysPresent(userId, monthStart(year, month), monthEnd(year, month));
    }
    case "TIME_BEFORE":
      return (await repo.hasCheckInBeforeMinutesOfDay(userId, def.threshold_value)) ? def.threshold_value : 0;
    case "TIME_AFTER":
      return (await repo.hasCheckInAtOrAfterMinutesOfDay(userId, def.threshold_value)) ? def.threshold_value : 0;
    default:
      return 0;
  }
}

async function isThresholdMet(userId: number, def: any, metrics: Awaited<ReturnType<typeof getUserMetrics>>, monthRank?: number | null) {
  switch (def.threshold_unit) {
    case "STREAK_DAYS":
      return metrics.currentStreak >= def.threshold_value || metrics.longestStreak >= def.threshold_value;
    case "MINUTES":
      return metrics.lifetimeMinutes >= def.threshold_value;
    case "DAYS":
      return metrics.lifetimeDaysPresent >= def.threshold_value;
    case "MONTH_MINUTES":
      return metrics.monthMinutes >= def.threshold_value;
    case "MONTH_DAYS":
      return metrics.monthDaysPresent >= def.threshold_value;
    case "RANK_POSITION":
      return monthRank != null && monthRank > 0 && monthRank <= def.threshold_value;
    case "DAY_MAX_MINUTES":
      return (await repo.getMaxSingleDayMinutes(userId)) >= def.threshold_value;
    case "MONTH_WEEKEND_DAYS": {
      const year = istYear();
      const month = istMonth();
      const days = await repo.getMonthWeekendDaysPresent(userId, monthStart(year, month), monthEnd(year, month));
      return days >= def.threshold_value;
    }
    case "TIME_BEFORE":
      return repo.hasCheckInBeforeMinutesOfDay(userId, def.threshold_value);
    case "TIME_AFTER":
      return repo.hasCheckInAtOrAfterMinutesOfDay(userId, def.threshold_value);
    default:
      return false;
  }
}

export async function evaluateAndAward(userId: number) {
  const user = await SimpleDatabase.query(`SELECT id FROM users WHERE id = $1`, [userId]);
  if (user.rows.length === 0) throw new Error("User not found");

  const year = istYear();
  const month = istMonth();
  const metrics = await getUserMetrics(userId, year, month);
  const monthRank = await getMonthRank(userId, year, month);
  const earnedIds = await repo.findEarnedDefinitionIds(userId);
  const definitions = await repo.findActiveDefinitions();
  const newlyUnlocked = [];

  for (const def of definitions) {
    if (earnedIds.has(Number(def.id))) continue;
    if (await isThresholdMet(userId, def, metrics, monthRank)) {
      const inserted = await repo.insertUserAchievement(userId, Number(def.id));
      if (!inserted?.isNew) continue;
      const full = await SimpleDatabase.query(
        `SELECT ua.earned_at, ad.code, ad.category, ad.title, ad.description, ad.icon_key
         FROM user_achievements ua JOIN achievement_definitions ad ON ad.id = ua.achievement_definition_id
         WHERE ua.id = $1`,
        [inserted.row.id]
      );
      newlyUnlocked.push(toUnlocked(full.rows[0]));
    }
  }

  await syncAchievementWhatsAppNotifications(userId);

  return newlyUnlocked;
}

async function syncAchievementWhatsAppNotifications(userId: number) {
  const { notifyAchievementsUnlockedBatch } = await import("../whatsapp/library-notifications.service");
  const definitions = await repo.findActiveDefinitions();
  const pending = await repo.findAchievementsNeedingWhatsApp(userId);
  if (pending.length === 0) return;

  const earnedCount = (await repo.findEarnedDefinitionIds(userId)).size;
  const totalCount = definitions.length;

  // ONE combined WhatsApp message for every not-yet-notified badge (names joined
  // by commas) instead of one per badge — avoids Meta's marketing frequency cap.
  await notifyAchievementsUnlockedBatch(
    userId,
    pending.map((b: any) => String(b.title)),
    pending.map((b: any) => String(b.description ?? "")),
    earnedCount,
    totalCount
  );

  // Mark notified regardless of delivery outcome: a single attempt, never re-spam.
  await repo.markAchievementsNotified(pending.map((b: any) => Number(b.id)));
}

export async function getUserAchievements(userId: number) {
  await evaluateAndAward(userId);
  const year = istYear();
  const month = istMonth();
  const metrics = await getUserMetrics(userId, year, month);
  const monthRank = await getMonthRank(userId, year, month);
  const definitions = await repo.findActiveDefinitions();
  const earnedRows = await repo.findUserAchievements(userId);
  const earnedMap = new Map<number, any>();
  for (const row of earnedRows) {
    earnedMap.set(Number(row.achievement_definition_id), row);
  }

  const progressList = [];
  let earnedCount = 0;
  for (const def of definitions) {
    const earned = earnedMap.get(Number(def.id));
    const currentValue = await currentValueForDefinition(userId, def, metrics, monthRank);
    const isEarned = earned != null;
    if (isEarned) earnedCount++;
    progressList.push({
      id: Number(def.id),
      code: def.code,
      category: def.category,
      title: def.title,
      description: def.description,
      iconKey: def.icon_key,
      thresholdValue: Number(def.threshold_value),
      thresholdUnit: def.threshold_unit,
      sortOrder: Number(def.sort_order),
      earned: isEarned,
      earnedAt: isEarned && earned.earned_at ? new Date(earned.earned_at).toISOString() : null,
      progressPercent: isEarned ? 100 : computeProgressPercent(def, currentValue),
      currentValue,
    });
  }

  return {
    earnedCount,
    totalCount: definitions.length,
    currentStreak: metrics.currentStreak,
    longestStreak: metrics.longestStreak,
    achievements: progressList,
  };
}

export async function getDefinitionsForPublic() {
  const definitions = await repo.findActiveDefinitions();
  return definitions.map((def) => ({
    id: Number(def.id),
    code: def.code,
    category: def.category,
    title: def.title,
    description: def.description,
    iconKey: def.icon_key,
    thresholdValue: Number(def.threshold_value),
    thresholdUnit: def.threshold_unit,
    sortOrder: Number(def.sort_order),
    earned: false,
    progressPercent: 0,
    currentValue: 0,
  }));
}

export async function getLatestMilestone(userId: number) {
  const row = await repo.findLatestAchievement(userId);
  if (!row) return null;
  return toUnlocked(row);
}

/** Personal analytics — port of UserMetricsService.getPersonalAnalytics */
export async function getPersonalAnalytics(userId: number, year?: number | null, month?: number | null) {
  const ym =
    year != null && month != null ? { year, month } : { year: istYear(), month: istMonth() };
  const metrics = await getUserMetrics(userId, ym.year, ym.month);
  const start = monthStart(ym.year, ym.month);
  const end = monthEnd(ym.year, ym.month);
  const today = istToday();
  const todayYear = parseInt(today.substring(0, 4), 10);
  const todayMonth = parseInt(today.substring(5, 7), 10);

  const daysElapsed =
    ym.year === todayYear && ym.month === todayMonth ? istDayOfMonth() : daysInMonth(ym.year, ym.month);

  const avgDailyHours =
    metrics.monthDaysPresent > 0 ? Math.round((minutesToHours(metrics.monthMinutes) / metrics.monthDaysPresent) * 10) / 10 : 0;

  const attendancePercent =
    daysElapsed > 0 ? Math.round((metrics.monthDaysPresent * 1000) / daysElapsed) / 10 : 0;

  const bestRes = await SimpleDatabase.query(
    `SELECT attendance_date, total_minutes FROM daily_attendance_summary
     WHERE user_id = $1 AND attendance_date >= $2 AND attendance_date <= $3
     ORDER BY total_minutes DESC LIMIT 1`,
    [userId, start, end]
  );

  let bestStudyDay: string | null = null;
  let bestStudyDayMinutes = 0;
  if (bestRes.rows.length > 0) {
    bestStudyDay = String(bestRes.rows[0].attendance_date).substring(0, 10);
    bestStudyDayMinutes = Number(bestRes.rows[0].total_minutes);
  }

  return {
    year: ym.year,
    month: ym.month,
    totalMinutesThisMonth: metrics.monthMinutes,
    totalHoursThisMonth: minutesToHours(metrics.monthMinutes),
    averageDailyHours: avgDailyHours,
    bestStudyDay,
    bestStudyDayMinutes,
    currentStreak: metrics.currentStreak,
    longestStreak: metrics.longestStreak,
    attendancePercent,
    daysPresentThisMonth: metrics.monthDaysPresent,
    daysElapsedInMonth: daysElapsed,
  };
}

export { EARLY_BIRD_MINUTES, NIGHT_OWL_MINUTES };
