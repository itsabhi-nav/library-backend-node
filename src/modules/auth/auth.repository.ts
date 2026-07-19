import { PoolClient } from "pg";
import { SimpleDatabase } from "../../core/database/SimpleDatabase";

const USER_COLUMNS = `id, member_id, email, password_hash, full_name, role, phone_number,
  address, dob, whatsapp_consent, is_active, last_login_at, assigned_seat_id, created_at`;

const SEAT_COLUMNS = `id, seat_number, status, has_power_outlet, created_at`;

type Runner = Pick<typeof SimpleDatabase, "query"> | PoolClient;

function run(runner: Runner | undefined, text: string, params: any[]) {
  if (runner && "query" in runner && typeof (runner as any).query === "function" && runner !== SimpleDatabase) {
    return (runner as PoolClient).query(text, params);
  }
  return SimpleDatabase.query(text, params);
}

export async function findById(id: number) {
  const res = await SimpleDatabase.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
  return res.rows[0] ?? null;
}

export async function findByMemberIdExact(memberId: string) {
  const res = await SimpleDatabase.query(`SELECT ${USER_COLUMNS} FROM users WHERE member_id = $1`, [memberId]);
  return res.rows[0] ?? null;
}

/** Port of findByMemberIdNormalized: REPLACE(UPPER(member_id),'-','') = :normalized */
export async function findByMemberIdNormalized(normalized: string) {
  const res = await SimpleDatabase.query(
    `SELECT ${USER_COLUMNS} FROM users WHERE REPLACE(UPPER(member_id), '-', '') = $1`,
    [normalized]
  );
  return res.rows[0] ?? null;
}

export async function findByEmail(email: string) {
  const res = await SimpleDatabase.query(`SELECT ${USER_COLUMNS} FROM users WHERE email = $1`, [email]);
  return res.rows[0] ?? null;
}

export async function existsByEmail(email: string): Promise<boolean> {
  const res = await SimpleDatabase.query(`SELECT 1 FROM users WHERE email = $1 LIMIT 1`, [email]);
  return res.rows.length > 0;
}

export async function findAllMembers() {
  const res = await SimpleDatabase.query(
    `SELECT ${USER_COLUMNS} FROM users WHERE role = 'MEMBER' ORDER BY id`,
    []
  );
  return res.rows;
}

export async function findAllOrderByCreatedAtDesc() {
  const res = await SimpleDatabase.query(`SELECT ${USER_COLUMNS} FROM users ORDER BY created_at DESC`, []);
  return res.rows;
}

export async function findSeatById(seatId: number, runner?: Runner) {
  const res = await run(runner, `SELECT ${SEAT_COLUMNS} FROM seats WHERE id = $1`, [seatId]);
  return res.rows[0] ?? null;
}

/** Map of user_id -> seat row, for embedding assignedSeat on a list of users. */
export async function loadSeatsForUsers(userRows: any[]): Promise<Map<number, any>> {
  const seatIds = [...new Set(userRows.map((u) => u.assigned_seat_id).filter((x) => x != null))];
  const map = new Map<number, any>();
  if (seatIds.length === 0) return map;
  const res = await SimpleDatabase.query(`SELECT ${SEAT_COLUMNS} FROM seats WHERE id = ANY($1::bigint[])`, [seatIds]);
  for (const s of res.rows) map.set(Number(s.id), s);
  return map;
}

/** Port of isSeatTakenByAnotherActiveMember. */
export async function isSeatTakenByAnotherActiveMember(
  seatId: number,
  excludeUserId: number | null,
  runner?: Runner
): Promise<boolean> {
  const res = await run(
    runner,
    `SELECT 1 FROM users
      WHERE assigned_seat_id = $1 AND role = 'MEMBER' AND is_active = true
        AND ($2::bigint IS NULL OR id <> $2)
      LIMIT 1`,
    [seatId, excludeUserId]
  );
  return res.rows.length > 0;
}

/**
 * Port of searchStudents — role=MEMBER, optional fuzzy search across full_name /
 * member_id / phone_number, and status filter. Returns a Spring-style page.
 */
export async function searchStudents(
  search: string | null,
  status: string,
  page: number,
  size: number
) {
  const where = `role = 'MEMBER'
      AND ($1::text IS NULL OR $1 = '' OR
           LOWER(full_name) LIKE LOWER('%' || $1 || '%') OR
           LOWER(member_id) LIKE LOWER('%' || $1 || '%') OR
           phone_number LIKE '%' || $1 || '%')
      AND ($2 = 'all' OR ($2 = 'active' AND is_active = true) OR ($2 = 'inactive' AND is_active = false))`;

  const countRes = await SimpleDatabase.query(`SELECT COUNT(*)::bigint AS c FROM users WHERE ${where}`, [
    search,
    status,
  ]);
  const total = Number(countRes.rows[0].c);

  const rowsRes = await SimpleDatabase.query(
    `SELECT ${USER_COLUMNS},
       (SELECT mp.shift_id FROM subscriptions sub
          JOIN membership_plans mp ON mp.id = sub.plan_id
         WHERE sub.user_id = users.id AND sub.status = 'ACTIVE'
           AND CURRENT_DATE BETWEEN sub.start_date AND sub.end_date
         ORDER BY sub.id DESC LIMIT 1) AS current_shift_id,
       (SELECT sub.discount_percent FROM subscriptions sub
         WHERE sub.user_id = users.id AND sub.status = 'ACTIVE'
           AND CURRENT_DATE BETWEEN sub.start_date AND sub.end_date
         ORDER BY sub.id DESC LIMIT 1) AS current_discount_percent
     FROM users WHERE ${where}
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4`,
    [search, status, size, page * size]
  );

  return { rows: rowsRes.rows, total };
}

export async function updateUser(id: number, fields: Record<string, any>, runner?: Runner) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return findById(id);
  const set = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  const res = await run(
    runner,
    `UPDATE users SET ${set} WHERE id = $1 RETURNING ${USER_COLUMNS}`,
    [id, ...keys.map((k) => fields[k])]
  );
  return res.rows[0] ?? null;
}

export { USER_COLUMNS, SEAT_COLUMNS };
