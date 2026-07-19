import { PoolClient } from "pg";
import { SimpleDatabase } from "../../core/database/SimpleDatabase";
import { SHIFT_COLUMNS } from "../booking/booking.repository";

const PLAN_COLUMNS = `id, name, description, duration_days, price, shift_id, is_active, created_at`;
const SUB_COLUMNS = `id, user_id, plan_id, start_date, end_date, status, paid_amount, payment_method, payment_status, discount_percent, created_at`;

type Runner = Pick<typeof SimpleDatabase, "query"> | PoolClient;

function run(runner: Runner | undefined, text: string, params: any[]) {
  if (runner && runner !== (SimpleDatabase as unknown)) {
    return (runner as PoolClient).query(text, params);
  }
  return SimpleDatabase.query(text, params);
}

const PLAN_SELECT = `mp.id, mp.name, mp.description, mp.duration_days, mp.price, mp.shift_id, mp.is_active, mp.created_at`;

export async function findActivePlans() {
  const res = await SimpleDatabase.query(
    `SELECT ${PLAN_SELECT},
            s.id AS s_id, s.name AS s_name, s.start_time AS s_start_time,
            s.end_time AS s_end_time, s.is_active AS s_is_active
     FROM membership_plans mp
     LEFT JOIN shifts s ON s.id = mp.shift_id
     WHERE mp.is_active = true
     ORDER BY mp.id`,
    []
  );
  return res.rows;
}

export async function findAllPlans() {
  const res = await SimpleDatabase.query(
    `SELECT ${PLAN_SELECT},
            s.id AS s_id, s.name AS s_name, s.start_time AS s_start_time,
            s.end_time AS s_end_time, s.is_active AS s_is_active
     FROM membership_plans mp
     LEFT JOIN shifts s ON s.id = mp.shift_id
     ORDER BY mp.id`,
    []
  );
  return res.rows;
}

export async function findPlanById(id: number, runner?: Runner) {
  const res = await run(
    runner,
    `SELECT ${PLAN_SELECT},
            s.id AS s_id, s.name AS s_name, s.start_time AS s_start_time,
            s.end_time AS s_end_time, s.is_active AS s_is_active
     FROM membership_plans mp
     LEFT JOIN shifts s ON s.id = mp.shift_id
     WHERE mp.id = $1`,
    [id]
  );
  return res.rows[0] ?? null;
}

export async function insertPlan(
  fields: {
    name: string;
    description: string | null;
    durationDays: number;
    price: number;
    shiftId: number | null;
    isActive: boolean;
  },
  runner?: Runner
) {
  const res = await run(
    runner,
    `INSERT INTO membership_plans (name, description, duration_days, price, shift_id, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${PLAN_COLUMNS}`,
    [fields.name, fields.description, fields.durationDays, fields.price, fields.shiftId, fields.isActive]
  );
  return res.rows[0];
}

export async function updatePlanRow(
  id: number,
  fields: Record<string, any>,
  runner?: Runner
) {
  const sets: string[] = [];
  const params: any[] = [id];
  let idx = 2;
  for (const [col, val] of Object.entries(fields)) {
    sets.push(`${col} = $${idx++}`);
    params.push(val);
  }
  if (sets.length === 0) return findPlanById(id, runner);
  const res = await run(
    runner,
    `UPDATE membership_plans SET ${sets.join(", ")} WHERE id = $1 RETURNING ${PLAN_COLUMNS}`,
    params
  );
  return res.rows[0] ?? null;
}

export async function deactivatePlan(id: number, runner?: Runner) {
  const res = await run(
    runner,
    `UPDATE membership_plans SET is_active = false WHERE id = $1 RETURNING ${PLAN_COLUMNS}`,
    [id]
  );
  return res.rows[0] ?? null;
}

export async function countActiveByPlanId(planId: number, today: string) {
  // Count distinct *members* only. Joining on role='MEMBER' keeps stray admin/test
  // subscriptions out of the stat, and COUNT(DISTINCT user_id) guards against a
  // member ever holding more than one active row for the same plan.
  const res = await SimpleDatabase.query(
    `SELECT COUNT(DISTINCT s.user_id)::bigint AS cnt
       FROM subscriptions s
       JOIN users u ON u.id = s.user_id AND u.role = 'MEMBER'
      WHERE s.plan_id = $1 AND s.status = 'ACTIVE'
        AND $2::date BETWEEN s.start_date AND s.end_date`,
    [planId, today]
  );
  return Number(res.rows[0]?.cnt ?? 0);
}

export async function sumRevenueByPlanId(planId: number) {
  const res = await SimpleDatabase.query(
    `SELECT COALESCE(SUM(paid_amount), 0) AS total FROM subscriptions WHERE plan_id = $1`,
    [planId]
  );
  return Number(res.rows[0]?.total ?? 0);
}

export async function findActiveSubscriptionForUser(userId: number, today: string) {
  const res = await SimpleDatabase.query(
    `SELECT ${SUB_COLUMNS} FROM subscriptions
     WHERE user_id = $1 AND status = 'ACTIVE' AND $2::date BETWEEN start_date AND end_date
     LIMIT 1`,
    [userId, today]
  );
  return res.rows[0] ?? null;
}

export async function findSubscriptionsByUserId(userId: number) {
  const res = await SimpleDatabase.query(
    `SELECT ${SUB_COLUMNS} FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return res.rows;
}

export async function cancelActiveSubscription(userId: number, today: string, runner?: Runner) {
  await run(
    runner,
    `UPDATE subscriptions SET status = 'CANCELLED'
     WHERE user_id = $1 AND status = 'ACTIVE' AND $2::date BETWEEN start_date AND end_date`,
    [userId, today]
  );
}

export async function insertSubscription(
  fields: {
    userId: number;
    planId: number;
    startDate: string;
    endDate: string;
    paidAmount: number;
    paymentMethod: string;
    discountPercent?: number;
  },
  runner?: Runner
) {
  const res = await run(
    runner,
    `INSERT INTO subscriptions (user_id, plan_id, start_date, end_date, status, paid_amount, payment_method, payment_status, discount_percent)
     VALUES ($1, $2, $3, $4, 'ACTIVE', $5, $6, 'PAID', $7)
     RETURNING ${SUB_COLUMNS}`,
    [
      fields.userId,
      fields.planId,
      fields.startDate,
      fields.endDate,
      fields.paidAmount,
      fields.paymentMethod,
      fields.discountPercent ?? 0,
    ]
  );
  return res.rows[0];
}

export async function findShiftById(id: number, runner?: Runner) {
  const res = await run(runner, `SELECT ${SHIFT_COLUMNS} FROM shifts WHERE id = $1`, [id]);
  return res.rows[0] ?? null;
}

export async function findUserById(userId: number) {
  const res = await SimpleDatabase.query(`SELECT id FROM users WHERE id = $1`, [userId]);
  return res.rows[0] ?? null;
}

export function planRowToShift(row: any) {
  if (row?.s_id == null) return null;
  return {
    id: row.s_id,
    name: row.s_name,
    start_time: row.s_start_time,
    end_time: row.s_end_time,
    is_active: row.s_is_active,
  };
}

export { PLAN_COLUMNS, SUB_COLUMNS };
