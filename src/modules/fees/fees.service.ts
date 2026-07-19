import { AppError } from "../../core/errors/AppError";
import { SimpleDatabase } from "../../core/database/SimpleDatabase";
import { serializeFeeInvoice } from "../../shared/serializers";
import { springPage } from "../../shared/springPage";
import { istToday, daysInMonth, monthStart, monthEnd, addDays, isPlanBillingCycleDay } from "../../shared/ist";
import { applyDiscount } from "../../shared/pricing";
import * as repo from "./fees.repository";
import type { FeePaymentInput } from "./fees.validator";

function todayIso(): string {
  return istToday();
}

async function getConfigInt(key: string, defaultVal: number): Promise<number> {
  const val = await repo.getConfigValue(key);
  if (val == null) return defaultVal;
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : defaultVal;
}

export function refreshStatus(invoice: {
  status: string;
  amount: number | string;
  amount_paid: number | string;
  due_date: string | Date;
}): string {
  if (invoice.status === "WAIVED") return "WAIVED";
  const amount = Number(invoice.amount);
  const paid = Number(invoice.amount_paid);
  const remaining = amount - paid;
  const dueStr =
    invoice.due_date instanceof Date
      ? invoice.due_date.toISOString().substring(0, 10)
      : String(invoice.due_date).substring(0, 10);

  if (remaining <= 0) return "PAID";
  if (paid > 0) return "PARTIAL";
  if (todayIso() > dueStr) return "OVERDUE";
  return "PENDING";
}

async function serializeInvoiceRow(row: any, seatMap?: Map<number, any>) {
  const status = refreshStatus(row);
  if (status !== row.status) {
    row = { ...row, status };
  }
  const user = {
    id: row.u_id ?? row.user_id,
    member_id: row.member_id,
    full_name: row.full_name,
    role: row.role,
    phone_number: row.phone_number,
    address: row.address,
    dob: row.dob,
    whatsapp_consent: row.whatsapp_consent,
    is_active: row.is_active,
    last_login_at: row.last_login_at,
    assigned_seat_id: row.assigned_seat_id,
    created_at: row.u_created_at ?? row.created_at,
  };
  const seat =
    user.assigned_seat_id != null
      ? seatMap?.get(Number(user.assigned_seat_id)) ??
        (await repo.loadSeatsForUsers([user])).get(Number(user.assigned_seat_id))
      : null;
  return serializeFeeInvoice(row, user, seat ?? null);
}

export async function generateForMonth(year: number, month: number) {
  if (month < 1 || month > 12) throw AppError.badRequest("Invalid month");

  const start = monthStart(year, month);
  const end = monthEnd(year, month);
  const dueDay = await getConfigInt("fee_due_day_of_month", 5);
  const maxDay = daysInMonth(year, month);
  const dueDate = `${year}-${String(month).padStart(2, "0")}-${String(Math.min(dueDay, maxDay)).padStart(2, "0")}`;

  const subs = await repo.findActiveSubscriptionsOverlappingMonth(start, end);
  let created = 0;
  let skipped = 0;
  const createdForNotify: { userId: number; amount: number; dueDate: string }[] = [];

  for (const sub of subs) {
    if (!sub.plan_id_ref && !sub.plan_id) {
      skipped++;
      continue;
    }
    const userId = Number(sub.user_id);
    const existing = await repo.findInvoiceByUserMonth(userId, year, month);
    if (existing) {
      skipped++;
      continue;
    }
    const billedAmount = applyDiscount(sub.plan_price, sub.discount_percent);
    try {
      await repo.insertInvoice({
        userId,
        subscriptionId: Number(sub.id),
        billingYear: year,
        billingMonth: month,
        amount: billedAmount,
        planName: sub.plan_name_ref,
        dueDate,
      });
      created++;
      createdForNotify.push({ userId, amount: billedAmount, dueDate });
    } catch (e: any) {
      if (e?.code === "23505") skipped++;
      else throw e;
    }
  }

  if (createdForNotify.length > 0) {
    const { notifyFeesGenerated } = await import("../whatsapp/library-notifications.service");
    void notifyFeesGenerated(createdForNotify, year, month).catch(() => {});
  }

  return { year, month, created, skipped };
}

/** Daily auto-billing: invoice every plan.duration_days from subscription start (12 PM IST cron). */
export async function runAutoFeeGenerationForToday() {
  const today = todayIso();
  const year = parseInt(today.substring(0, 4), 10);
  const month = parseInt(today.substring(5, 7), 10);
  const graceDays = await getConfigInt("fee_due_grace_days", 5);
  const dueDate = addDays(today, graceDays);

  const subs = await repo.findActiveMemberSubscriptions();
  let created = 0;
  let skipped = 0;
  const createdForNotify: { userId: number; amount: number; dueDate: string }[] = [];

  for (const sub of subs) {
    const startDate = String(sub.start_date).substring(0, 10);
    const durationDays = Number(sub.duration_days ?? 30);
    if (!isPlanBillingCycleDay(startDate, today, durationDays)) {
      skipped++;
      continue;
    }

    const userId = Number(sub.user_id);
    if (await repo.findInvoiceGeneratedOnDate(userId, today)) {
      skipped++;
      continue;
    }

    const billedAmount = applyDiscount(sub.plan_price, sub.discount_percent);
    try {
      await repo.insertInvoice({
        userId,
        subscriptionId: Number(sub.id),
        billingYear: year,
        billingMonth: month,
        amount: billedAmount,
        planName: sub.plan_name_ref,
        dueDate,
      });
      created++;
      createdForNotify.push({ userId, amount: billedAmount, dueDate });
    } catch (e: any) {
      if (e?.code === "23505") skipped++;
      else throw e;
    }
  }

  if (createdForNotify.length > 0) {
    const { notifyFeesGenerated } = await import("../whatsapp/library-notifications.service");
    void notifyFeesGenerated(createdForNotify, year, month).catch(() => {});
  }

  return { date: today, year, month, created, skipped };
}

export async function refreshOverdueStatuses(year: number, month: number) {
  const candidates = await repo.findOverdueCandidates(year, month);
  const today = todayIso();
  for (const inv of candidates) {
    if (today > String(inv.due_date).substring(0, 10) && Number(inv.amount_paid) < Number(inv.amount)) {
      const newStatus = Number(inv.amount_paid) > 0 ? "PARTIAL" : "OVERDUE";
      if (inv.status !== newStatus) {
        await repo.updateInvoiceStatus(Number(inv.id), newStatus);
      }
    }
  }
}

export async function searchInvoices(
  year: number | null,
  month: number | null,
  statusStr: string | null,
  search: string | null,
  page: number,
  size: number
) {
  let status: string | null = null;
  if (statusStr && statusStr.trim() !== "" && statusStr.toLowerCase() !== "all") {
    status = statusStr.toUpperCase();
  }

  const { rows, total } = await repo.searchInvoices(year, month, status, search, page, size);
  const seatMap = await repo.loadSeatsForUsers(
    rows.map((r) => ({ assigned_seat_id: r.assigned_seat_id }))
  );
  const content = await Promise.all(rows.map((r) => serializeInvoiceRow(r, seatMap)));
  return springPage(content, total, page, size);
}

export async function getStats(year: number, month: number) {
  await refreshOverdueStatuses(year, month);
  const outstanding = await repo.sumOutstandingForMonth(year, month);
  const collected = await repo.sumCollectedForMonth(year, month);
  const outstandingCount = await repo.countOutstandingForMonth(year, month);
  const overdueCount = await repo.countOverdueForMonth(year, month);
  return {
    year,
    month,
    totalOutstanding: outstanding,
    totalCollected: collected,
    outstandingCount,
    overdueCount,
    generatedCount: outstandingCount + overdueCount,
  };
}

export async function getMyInvoices(userId: number) {
  const rows = await repo.findInvoicesByUserId(userId);
  return Promise.all(rows.map((r) => serializeInvoiceRow(r)));
}

export async function getMyPaymentHistory(userId: number) {
  const rows = await repo.findPaymentsForUser(userId);
  return rows.map((r) => {
    const invoiceAmount = Number(r.invoice_amount);
    const cumulativePaid = Number(r.cumulative_paid);
    return {
      id: Number(r.id),
      amount: Number(r.amount),
      paymentMethod: r.payment_method ?? "CASH",
      paidAt: r.paid_at instanceof Date ? r.paid_at.toISOString() : String(r.paid_at),
      notes: r.notes ?? null,
      invoiceId: Number(r.invoice_id),
      billingYear: Number(r.billing_year),
      billingMonth: Number(r.billing_month),
      planName: r.plan_name ?? null,
      invoiceAmount,
      remainingAfter: Math.max(0, invoiceAmount - cumulativePaid),
    };
  });
}

export async function getCurrentMonthInvoice(userId: number) {
  const now = todayIso();
  const year = parseInt(now.substring(0, 4), 10);
  const month = parseInt(now.substring(5, 7), 10);
  const row = await repo.findInvoiceByUserMonth(userId, year, month);
  if (!row) return null;
  return serializeInvoiceRow(row);
}

export async function recordPayment(invoiceId: number, request: FeePaymentInput, recordedById: number) {
  if (request.amount <= 0) throw AppError.badRequest("Payment amount must be positive");

  return SimpleDatabase.withTransaction(async (client) => {
    const invoice = await repo.findInvoiceById(invoiceId, client);
    if (!invoice) throw AppError.badRequest("Invoice not found");
    if (invoice.status === "WAIVED") throw AppError.badRequest("Cannot record payment on waived invoice");

    const recorder = await SimpleDatabase.query(`SELECT id FROM users WHERE id = $1`, [recordedById]);
    if (recorder.rows.length === 0) throw AppError.badRequest("Recorder not found");

    await repo.insertPayment(
      invoiceId,
      request.amount,
      request.paymentMethod ?? "CASH",
      recordedById,
      request.notes ?? null,
      client
    );

    const newPaid = Number(invoice.amount_paid) + request.amount;
    const status = refreshStatus({ ...invoice, amount_paid: newPaid });
    const updated = await repo.updateInvoiceAmountPaid(invoiceId, newPaid, status, client);

    if (status === "PAID" && invoice.subscription_id) {
      const planRes = await client.query(
        `SELECT p.duration_days FROM subscriptions s
         JOIN membership_plans p ON p.id = s.plan_id
         WHERE s.id = $1 LIMIT 1`,
        [invoice.subscription_id]
      );
      const durationDays = Number(planRes.rows[0]?.duration_days ?? 30);
      await repo.extendSubscriptionEndDate(Number(invoice.subscription_id), durationDays, client);
    }

    const remaining = Math.max(0, Number(invoice.amount) - newPaid);
    void import("../whatsapp/library-notifications.service").then(({ notifyPaymentReceived }) =>
      notifyPaymentReceived(
        Number(invoice.user_id),
        request.amount,
        Number(invoice.billing_year),
        Number(invoice.billing_month),
        remaining
      ).catch(() => {})
    );

    return serializeInvoiceRow(updated!);
  });
}

export async function waiveInvoice(invoiceId: number) {
  const invoice = await repo.findInvoiceById(invoiceId);
  if (!invoice) throw AppError.badRequest("Invoice not found");
  const updated = await repo.updateInvoiceStatus(invoiceId, "WAIVED");
  return serializeInvoiceRow(updated!);
}

export async function scheduledOverdueCheck() {
  const now = todayIso();
  const year = parseInt(now.substring(0, 4), 10);
  const month = parseInt(now.substring(5, 7), 10);
  await refreshOverdueStatuses(year, month);
}

export async function getPaymentHistory(
  year: number | null,
  month: number | null,
  search: string | null,
  page: number,
  size: number
) {
  const { rows, total } = await repo.searchPayments(year, month, search, page, size);
  const content = rows.map((r) => {
    const invoiceAmount = Number(r.invoice_amount);
    const cumulativePaid = Number(r.cumulative_paid);
    const remainingAfter = Math.max(0, invoiceAmount - cumulativePaid);
    return {
      id: Number(r.id),
      amount: Number(r.amount),
      paymentMethod: r.payment_method ?? "CASH",
      paidAt: r.paid_at instanceof Date ? r.paid_at.toISOString() : String(r.paid_at),
      notes: r.notes ?? null,
      invoiceId: Number(r.invoice_id),
      billingYear: Number(r.billing_year),
      billingMonth: Number(r.billing_month),
      planName: r.plan_name ?? null,
      invoiceAmount,
      remainingAfter,
      userId: Number(r.user_id),
      memberId: r.member_id,
      fullName: r.full_name,
      recordedByName: r.recorded_by_name ?? null,
    };
  });
  return springPage(content, total, page, size);
}
