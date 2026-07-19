import { PoolClient } from "pg";
import { SimpleDatabase } from "../../core/database/SimpleDatabase";
import { USER_COLUMNS, SEAT_COLUMNS } from "../auth/auth.repository";

const INVOICE_COLUMNS = `id, user_id, subscription_id, billing_year, billing_month, amount, plan_name, due_date, status, amount_paid, generated_at`;

type Runner = Pick<typeof SimpleDatabase, "query"> | PoolClient;

function run(runner: Runner | undefined, text: string, params: any[]) {
  if (runner && runner !== (SimpleDatabase as unknown)) {
    return (runner as PoolClient).query(text, params);
  }
  return SimpleDatabase.query(text, params);
}

export async function getConfigValue(key: string): Promise<string | null> {
  const res = await SimpleDatabase.query(`SELECT config_value FROM library_config WHERE config_key = $1`, [key]);
  return res.rows[0]?.config_value ?? null;
}

export async function findActiveMemberSubscriptions() {
  const res = await SimpleDatabase.query(
    `SELECT s.id, s.user_id, s.plan_id, s.start_date, s.end_date, s.status, s.discount_percent,
            p.name AS plan_name_ref, p.price AS plan_price, p.duration_days
     FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     JOIN membership_plans p ON p.id = s.plan_id
     WHERE s.status = 'ACTIVE'
       AND u.role = 'MEMBER'
       AND u.is_active = true
       AND s.end_date >= CURRENT_DATE`,
    []
  );
  return res.rows;
}

export async function extendSubscriptionEndDate(
  subscriptionId: number,
  durationDays: number,
  runner?: Runner
) {
  const res = await run(
    runner,
    `UPDATE subscriptions SET
       end_date = (GREATEST(end_date, CURRENT_DATE) + ($2::int * INTERVAL '1 day'))::date,
       status = 'ACTIVE'
     WHERE id = $1
     RETURNING id, end_date`,
    [subscriptionId, durationDays]
  );
  return res.rows[0] ?? null;
}

export async function findActiveSubscriptionsOverlappingMonth(monthStart: string, monthEnd: string) {
  const res = await SimpleDatabase.query(
    `SELECT s.id, s.user_id, s.plan_id, s.start_date, s.end_date, s.status, s.discount_percent,
            p.id AS plan_id_ref, p.name AS plan_name_ref, p.price AS plan_price
     FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     JOIN membership_plans p ON p.id = s.plan_id
     WHERE s.status = 'ACTIVE'
       AND s.start_date <= $2::date
       AND s.end_date >= $1::date`,
    [monthStart, monthEnd]
  );
  return res.rows;
}

export async function findInvoiceByUserMonth(userId: number, year: number, month: number) {
  const res = await SimpleDatabase.query(
    `SELECT ${INVOICE_COLUMNS} FROM fee_invoices
     WHERE user_id = $1 AND billing_year = $2 AND billing_month = $3 LIMIT 1`,
    [userId, year, month]
  );
  return res.rows[0] ?? null;
}

export async function findInvoiceGeneratedOnDate(userId: number, dateIso: string) {
  const res = await SimpleDatabase.query(
    `SELECT ${INVOICE_COLUMNS} FROM fee_invoices
     WHERE user_id = $1 AND DATE(generated_at AT TIME ZONE 'Asia/Kolkata') = $2::date
     LIMIT 1`,
    [userId, dateIso]
  );
  return res.rows[0] ?? null;
}

export async function insertInvoice(
  fields: {
    userId: number;
    subscriptionId: number;
    billingYear: number;
    billingMonth: number;
    amount: number;
    planName: string;
    dueDate: string;
    status?: string;
    amountPaid?: number;
  },
  runner?: Runner
) {
  const status = fields.status ?? "PENDING";
  const amountPaid = fields.amountPaid ?? 0;
  const res = await run(
    runner,
    `INSERT INTO fee_invoices (user_id, subscription_id, billing_year, billing_month, amount, plan_name, due_date, status, amount_paid)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${INVOICE_COLUMNS}`,
    [
      fields.userId,
      fields.subscriptionId,
      fields.billingYear,
      fields.billingMonth,
      fields.amount,
      fields.planName,
      fields.dueDate,
      status,
      amountPaid,
    ]
  );
  return res.rows[0];
}

export async function searchInvoices(
  year: number | null,
  month: number | null,
  status: string | null,
  search: string | null,
  page: number,
  size: number
) {
  const conditions: string[] = ["u.role = 'MEMBER'"];
  const params: any[] = [];
  let idx = 1;

  if (year != null) {
    conditions.push(`fi.billing_year = $${idx++}`);
    params.push(year);
  }
  if (month != null) {
    conditions.push(`fi.billing_month = $${idx++}`);
    params.push(month);
  }
  if (status != null) {
    conditions.push(`fi.status = $${idx++}`);
    params.push(status);
  }
  if (search != null && search !== "") {
    conditions.push(
      `(LOWER(u.full_name) LIKE LOWER($${idx}) OR LOWER(u.member_id) LIKE LOWER($${idx}))`
    );
    params.push(`%${search}%`);
    idx++;
  }

  const where = conditions.join(" AND ");
  const countRes = await SimpleDatabase.query(
    `SELECT COUNT(*)::bigint AS total FROM fee_invoices fi JOIN users u ON u.id = fi.user_id WHERE ${where}`,
    params
  );
  const total = Number(countRes.rows[0]?.total ?? 0);

  const offset = page * size;
  const listRes = await SimpleDatabase.query(
    `SELECT fi.id, fi.user_id, fi.subscription_id, fi.billing_year, fi.billing_month,
            fi.amount, fi.plan_name, fi.due_date, fi.status, fi.amount_paid, fi.generated_at,
            u.id AS u_id, u.member_id, u.full_name, u.role, u.phone_number, u.address, u.dob,
            u.whatsapp_consent, u.is_active, u.last_login_at, u.assigned_seat_id, u.created_at AS u_created_at
     FROM fee_invoices fi
     JOIN users u ON u.id = fi.user_id
     WHERE ${where}
     ORDER BY fi.billing_year DESC, fi.billing_month DESC, u.full_name ASC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, size, offset]
  );

  return { rows: listRes.rows, total };
}

export async function findOverdueCandidates(year: number, month: number) {
  const res = await SimpleDatabase.query(
    `SELECT ${INVOICE_COLUMNS} FROM fee_invoices
     WHERE billing_year = $1 AND billing_month = $2 AND status IN ('PENDING', 'OVERDUE', 'PARTIAL')
     ORDER BY due_date ASC`,
    [year, month]
  );
  return res.rows;
}

export async function updateInvoiceStatus(id: number, status: string, runner?: Runner) {
  const res = await run(
    runner,
    `UPDATE fee_invoices SET status = $2 WHERE id = $1 RETURNING ${INVOICE_COLUMNS}`,
    [id, status]
  );
  return res.rows[0] ?? null;
}

export async function updateInvoiceAmountPaid(id: number, amountPaid: number, status: string, runner?: Runner) {
  const res = await run(
    runner,
    `UPDATE fee_invoices SET amount_paid = $2, status = $3 WHERE id = $1 RETURNING ${INVOICE_COLUMNS}`,
    [id, amountPaid, status]
  );
  return res.rows[0] ?? null;
}

export async function findInvoiceById(id: number, runner?: Runner) {
  const res = await run(runner, `SELECT ${INVOICE_COLUMNS} FROM fee_invoices WHERE id = $1`, [id]);
  return res.rows[0] ?? null;
}

export async function sumOutstandingForMonth(year: number, month: number) {
  const res = await SimpleDatabase.query(
    `SELECT COALESCE(SUM(amount - amount_paid), 0) AS total FROM fee_invoices
     WHERE billing_year = $1 AND billing_month = $2 AND status IN ('PENDING', 'OVERDUE', 'PARTIAL')`,
    [year, month]
  );
  return Number(res.rows[0]?.total ?? 0);
}

export async function sumCollectedForMonth(year: number, month: number) {
  const res = await SimpleDatabase.query(
    `SELECT COALESCE(SUM(amount_paid), 0) AS total FROM fee_invoices WHERE billing_year = $1 AND billing_month = $2`,
    [year, month]
  );
  return Number(res.rows[0]?.total ?? 0);
}

export async function countOutstandingForMonth(year: number, month: number) {
  const res = await SimpleDatabase.query(
    `SELECT COUNT(*)::bigint AS cnt FROM fee_invoices
     WHERE billing_year = $1 AND billing_month = $2 AND status IN ('PENDING', 'OVERDUE', 'PARTIAL')`,
    [year, month]
  );
  return Number(res.rows[0]?.cnt ?? 0);
}

export async function countOverdueForMonth(year: number, month: number) {
  const res = await SimpleDatabase.query(
    `SELECT COUNT(*)::bigint AS cnt FROM fee_invoices
     WHERE billing_year = $1 AND billing_month = $2 AND status = 'OVERDUE'`,
    [year, month]
  );
  return Number(res.rows[0]?.cnt ?? 0);
}

export async function findInvoicesByUserId(userId: number) {
  const res = await SimpleDatabase.query(
    `SELECT ${INVOICE_COLUMNS} FROM fee_invoices
     WHERE user_id = $1 ORDER BY billing_year DESC, billing_month DESC`,
    [userId]
  );
  return res.rows;
}

export async function insertPayment(
  invoiceId: number,
  amount: number,
  paymentMethod: string,
  recordedById: number,
  notes: string | null,
  runner?: Runner
) {
  await run(
    runner,
    `INSERT INTO fee_payments (invoice_id, amount, payment_method, recorded_by, notes)
     VALUES ($1, $2, $3, $4, $5)`,
    [invoiceId, amount, paymentMethod, recordedById, notes]
  );
}

export async function loadSeatsForUsers(userRows: { assigned_seat_id: number | null }[]) {
  const seatIds = [...new Set(userRows.map((u) => u.assigned_seat_id).filter((x) => x != null))];
  const map = new Map<number, any>();
  if (seatIds.length === 0) return map;
  const res = await SimpleDatabase.query(`SELECT ${SEAT_COLUMNS} FROM seats WHERE id = ANY($1::bigint[])`, [seatIds]);
  for (const s of res.rows) map.set(Number(s.id), s);
  return map;
}

export async function searchPayments(
  year: number | null,
  month: number | null,
  search: string | null,
  page: number,
  size: number
) {
  const conditions: string[] = ["u.role = 'MEMBER'"];
  const params: any[] = [];
  let idx = 1;

  if (year != null) {
    conditions.push(`fi.billing_year = $${idx++}`);
    params.push(year);
  }
  if (month != null) {
    conditions.push(`fi.billing_month = $${idx++}`);
    params.push(month);
  }
  if (search != null && search !== "") {
    conditions.push(
      `(LOWER(u.full_name) LIKE LOWER($${idx}) OR LOWER(u.member_id) LIKE LOWER($${idx}))`
    );
    params.push(`%${search}%`);
    idx++;
  }

  const where = conditions.join(" AND ");
  const countRes = await SimpleDatabase.query(
    `SELECT COUNT(*)::bigint AS total
     FROM fee_payments fp
     JOIN fee_invoices fi ON fi.id = fp.invoice_id
     JOIN users u ON u.id = fi.user_id
     WHERE ${where}`,
    params
  );
  const total = Number(countRes.rows[0]?.total ?? 0);

  const offset = page * size;
  const listRes = await SimpleDatabase.query(
    `SELECT fp.id, fp.amount, fp.payment_method, fp.paid_at, fp.notes,
            fi.id AS invoice_id, fi.billing_year, fi.billing_month, fi.plan_name,
            fi.amount AS invoice_amount,
            SUM(fp.amount) OVER (
              PARTITION BY fi.id ORDER BY fp.paid_at ASC, fp.id ASC
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS cumulative_paid,
            u.id AS user_id, u.member_id, u.full_name,
            r.full_name AS recorded_by_name
     FROM fee_payments fp
     JOIN fee_invoices fi ON fi.id = fp.invoice_id
     JOIN users u ON u.id = fi.user_id
     LEFT JOIN users r ON r.id = fp.recorded_by
     WHERE ${where}
     ORDER BY fp.paid_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, size, offset]
  );

  return { rows: listRes.rows, total };
}

export async function findPaymentsForUser(userId: number) {
  const res = await SimpleDatabase.query(
    `SELECT fp.id, fp.amount, fp.payment_method, fp.paid_at, fp.notes,
            fi.id AS invoice_id, fi.billing_year, fi.billing_month, fi.plan_name,
            fi.amount AS invoice_amount,
            SUM(fp.amount) OVER (
              PARTITION BY fi.id ORDER BY fp.paid_at ASC, fp.id ASC
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS cumulative_paid
     FROM fee_payments fp
     JOIN fee_invoices fi ON fi.id = fp.invoice_id
     WHERE fi.user_id = $1
     ORDER BY fp.paid_at DESC`,
    [userId]
  );
  return res.rows;
}

export { INVOICE_COLUMNS, USER_COLUMNS };
