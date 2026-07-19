import { SimpleDatabase } from "../../core/database/SimpleDatabase";

export async function findActiveDefinitions() {
  const res = await SimpleDatabase.query(
    `SELECT id, code, category, title, description, icon_key, threshold_value, threshold_unit, sort_order, is_active
     FROM achievement_definitions WHERE is_active = true ORDER BY sort_order ASC`,
    []
  );
  return res.rows;
}

export async function findEarnedDefinitionIds(userId: number): Promise<Set<number>> {
  const res = await SimpleDatabase.query(
    `SELECT achievement_definition_id FROM user_achievements WHERE user_id = $1`,
    [userId]
  );
  return new Set(res.rows.map((r) => Number(r.achievement_definition_id)));
}

export async function findUserAchievements(userId: number) {
  const res = await SimpleDatabase.query(
    `SELECT ua.id, ua.user_id, ua.achievement_definition_id, ua.earned_at,
            ad.code, ad.category, ad.title, ad.description, ad.icon_key,
            ad.threshold_value, ad.threshold_unit, ad.sort_order
     FROM user_achievements ua
     JOIN achievement_definitions ad ON ad.id = ua.achievement_definition_id
     WHERE ua.user_id = $1 ORDER BY ua.earned_at DESC`,
    [userId]
  );
  return res.rows;
}

export async function findLatestAchievement(userId: number) {
  const res = await SimpleDatabase.query(
    `SELECT ua.earned_at, ad.code, ad.category, ad.title, ad.description, ad.icon_key
     FROM user_achievements ua
     JOIN achievement_definitions ad ON ad.id = ua.achievement_definition_id
     WHERE ua.user_id = $1 ORDER BY ua.earned_at DESC LIMIT 1`,
    [userId]
  );
  return res.rows[0] ?? null;
}

export async function findAchievementsNeedingWhatsApp(userId: number) {
  // Badges the member has earned but not yet been WhatsApp-notified about. The
  // caller batches ALL of these into ONE combined message (comma-separated names)
  // rather than one message per badge — the per-message MARKETING frequency cap
  // (Meta 131049) was failing all but the first. `whatsapp_notified` is flipped
  // true after the single combined attempt, so nothing re-sends.
  const res = await SimpleDatabase.query(
    `SELECT ua.id, ad.title, ad.description, ua.earned_at
     FROM user_achievements ua
     JOIN achievement_definitions ad ON ad.id = ua.achievement_definition_id
     WHERE ua.user_id = $1
       AND ua.whatsapp_notified = false
     ORDER BY ua.earned_at ASC`,
    [userId]
  );
  return res.rows;
}

export async function markAchievementsNotified(userAchievementIds: number[]) {
  if (userAchievementIds.length === 0) return;
  await SimpleDatabase.query(
    `UPDATE user_achievements SET whatsapp_notified = true WHERE id = ANY($1::bigint[])`,
    [userAchievementIds]
  );
}

export async function insertUserAchievement(
  userId: number,
  definitionId: number
): Promise<{ row: { id: number; earned_at: Date | null }; isNew: boolean } | null> {
  const res = await SimpleDatabase.query(
    `INSERT INTO user_achievements (user_id, achievement_definition_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, achievement_definition_id) DO NOTHING
     RETURNING id, user_id, achievement_definition_id, earned_at`,
    [userId, definitionId]
  );
  if (res.rows.length > 0) {
    return { row: res.rows[0], isNew: true };
  }
  return null;
}

export async function hasCheckInBeforeMinutesOfDay(userId: number, minutesOfDay: number): Promise<boolean> {
  const res = await SimpleDatabase.query(
    `SELECT EXISTS(
       SELECT 1 FROM attendance a
       WHERE a.user_id = $1
         AND EXTRACT(HOUR FROM a.check_in_time AT TIME ZONE 'Asia/Kolkata') * 60
             + EXTRACT(MINUTE FROM a.check_in_time AT TIME ZONE 'Asia/Kolkata') < $2
     ) AS found`,
    [userId, minutesOfDay]
  );
  return res.rows[0]?.found === true;
}

export async function hasCheckInAtOrAfterMinutesOfDay(userId: number, minutesOfDay: number): Promise<boolean> {
  const res = await SimpleDatabase.query(
    `SELECT EXISTS(
       SELECT 1 FROM attendance a
       WHERE a.user_id = $1
         AND EXTRACT(HOUR FROM a.check_in_time AT TIME ZONE 'Asia/Kolkata') * 60
             + EXTRACT(MINUTE FROM a.check_in_time AT TIME ZONE 'Asia/Kolkata') >= $2
     ) AS found`,
    [userId, minutesOfDay]
  );
  return res.rows[0]?.found === true;
}

export async function getMaxSingleDayMinutes(userId: number): Promise<number> {
  const res = await SimpleDatabase.query(
    `SELECT COALESCE(MAX(total_minutes), 0)::int AS max_minutes
     FROM daily_attendance_summary WHERE user_id = $1`,
    [userId]
  );
  return Number(res.rows[0]?.max_minutes ?? 0);
}

export async function getMonthWeekendDaysPresent(userId: number, start: string, end: string): Promise<number> {
  const res = await SimpleDatabase.query(
    `SELECT COUNT(*)::int AS days
     FROM daily_attendance_summary
     WHERE user_id = $1
       AND attendance_date >= $2 AND attendance_date <= $3
       AND total_minutes > 0
       AND EXTRACT(DOW FROM attendance_date) IN (0, 6)`,
    [userId, start, end]
  );
  return Number(res.rows[0]?.days ?? 0);
}
