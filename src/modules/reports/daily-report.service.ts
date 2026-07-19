import { logger } from "../../config/logger";
import { SimpleDatabase } from "../../core/database/SimpleDatabase";
import {
  istToday,
  addDays,
  formatTimeIST12h,
  formatDurationHrsMin,
  formatINRAmount,
  formatBillingMonth,
  formatDateShortIST,
} from "../../shared/ist";
import { formatShiftTime12h } from "../../shared/shift-utils";
import { getAdminPhoneNumbers } from "../whatsapp/notify.helpers";
import { TEMPLATES, TEMPLATE_LANGUAGE } from "../whatsapp/notify.helpers";
import { whatsappConfig } from "../whatsapp/whatsapp.config";
import { uploadMediaToMeta, sendDocumentTemplate } from "../whatsapp/whatsapp.service";
import {
  buildDailyReportPdf,
  DailyReportData,
  ReportShiftGroup,
  ReportMemberAttendance,
} from "./daily-report.pdf";

function daysBetween(aIso: string, bIso: string): number {
  const [ay, am, ad] = aIso.substring(0, 10).split("-").map((x) => parseInt(x, 10));
  const [by, bm, bd] = bIso.substring(0, 10).split("-").map((x) => parseInt(x, 10));
  return Math.round((Date.UTC(by!, bm! - 1, bd!) - Date.UTC(ay!, am! - 1, ad!)) / 86_400_000);
}

async function getConfig(key: string, fallback: string): Promise<string> {
  const res = await SimpleDatabase.query(
    `SELECT config_value FROM library_config WHERE config_key = $1 LIMIT 1`,
    [key]
  );
  const v = String(res.rows[0]?.config_value ?? "").trim();
  return v || fallback;
}

/** Assemble every section of the daily report from the DB. */
export async function buildDailyReportData(): Promise<DailyReportData> {
  const today = istToday();
  const libraryName = await getConfig("library_name", "Library");

  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date());

  // ── Attendance today, aggregated per member (first in / last out / total) ──
  const attRes = await SimpleDatabase.query(
    `SELECT u.member_id, u.full_name,
            sh.name AS shift_name, sh.start_time, sh.end_time,
            MIN(a.check_in_time) AS first_in,
            MAX(a.check_out_time) AS last_out,
            BOOL_OR(a.check_out_time IS NULL) AS still_in,
            SUM(EXTRACT(EPOCH FROM (COALESCE(a.check_out_time, NOW()) - a.check_in_time)) / 60) AS minutes
       FROM attendance a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN subscriptions sub ON sub.user_id = u.id AND sub.status = 'ACTIVE'
         AND CURRENT_DATE BETWEEN sub.start_date AND sub.end_date
       LEFT JOIN membership_plans mp ON mp.id = sub.plan_id
       LEFT JOIN shifts sh ON sh.id = mp.shift_id
      WHERE DATE(a.check_in_time AT TIME ZONE 'Asia/Kolkata') = $1::date
      GROUP BY u.id, u.member_id, u.full_name, sh.name, sh.start_time, sh.end_time
      ORDER BY sh.start_time NULLS LAST, u.full_name ASC`,
    [today]
  );

  const shiftMap = new Map<string, ReportShiftGroup>();
  for (const row of attRes.rows) {
    const shiftName = row.shift_name ? String(row.shift_name) : "No shift / Unassigned";
    const timeLabel =
      row.start_time && row.end_time
        ? `${formatShiftTime12h(String(row.start_time))} – ${formatShiftTime12h(String(row.end_time))}`
        : "—";
    const key = `${shiftName}|${timeLabel}`;
    if (!shiftMap.has(key)) shiftMap.set(key, { name: shiftName, timeLabel, members: [] });
    const member: ReportMemberAttendance = {
      name: String(row.full_name ?? "").trim(),
      memberId: String(row.member_id ?? ""),
      inLabel: row.first_in ? formatTimeIST12h(row.first_in) : "—",
      outLabel: row.still_in ? "still in" : row.last_out ? formatTimeIST12h(row.last_out) : "—",
      hoursLabel: formatDurationHrsMin(Math.max(0, Math.round(Number(row.minutes ?? 0)))),
    };
    shiftMap.get(key)!.members.push(member);
  }
  const shifts = Array.from(shiftMap.values());
  const presentCount = attRes.rows.length;

  // ── Fees paid today ─────────────────────────────────────────────────────────
  const paidRes = await SimpleDatabase.query(
    `SELECT u.member_id, u.full_name, fp.amount, fp.paid_at
       FROM fee_payments fp
       JOIN fee_invoices fi ON fi.id = fp.invoice_id
       JOIN users u ON u.id = fi.user_id
      WHERE DATE(fp.paid_at AT TIME ZONE 'Asia/Kolkata') = $1::date
      ORDER BY fp.paid_at ASC`,
    [today]
  );
  let collectedToday = 0;
  const paidToday = paidRes.rows.map((row: any) => {
    collectedToday += Number(row.amount);
    return {
      name: String(row.full_name ?? "").trim(),
      memberId: String(row.member_id ?? ""),
      amountLabel: `₹${formatINRAmount(row.amount)}`,
      timeLabel: formatTimeIST12h(row.paid_at),
    };
  });
  const collectedTodayLabel =
    paidToday.length > 0
      ? `₹${formatINRAmount(collectedToday)} from ${paidToday.length} payment(s)`
      : "₹0";

  // ── Pending dues (accrual: summed per member) ────────────────────────────────
  const dueRes = await SimpleDatabase.query(
    `SELECT u.member_id, u.full_name,
            SUM(fi.amount - fi.amount_paid) AS pending,
            MIN(fi.billing_year * 100 + fi.billing_month) AS oldest_ym
       FROM fee_invoices fi
       JOIN users u ON u.id = fi.user_id
      WHERE fi.status NOT IN ('PAID', 'WAIVED')
        AND fi.amount > fi.amount_paid
        AND u.role = 'MEMBER' AND u.is_active = true
      GROUP BY u.id, u.member_id, u.full_name
      ORDER BY pending DESC`,
    []
  );
  let duesTotal = 0;
  const dues = dueRes.rows.map((row: any) => {
    const pending = Number(row.pending);
    duesTotal += pending;
    const ym = Number(row.oldest_ym);
    return {
      name: String(row.full_name ?? "").trim(),
      memberId: String(row.member_id ?? ""),
      amountLabel: `₹${formatINRAmount(pending)}`,
      sinceLabel: formatBillingMonth(Math.floor(ym / 100), ym % 100),
    };
  });
  const duesTotalLabel = `₹${formatINRAmount(duesTotal)}`;

  // ── Next auto fee-generation per member ──────────────────────────────────────
  const subRes = await SimpleDatabase.query(
    `SELECT u.member_id, u.full_name, s.start_date, p.duration_days
       FROM subscriptions s
       JOIN users u ON u.id = s.user_id
       JOIN membership_plans p ON p.id = s.plan_id
      WHERE s.status = 'ACTIVE' AND u.role = 'MEMBER' AND u.is_active = true`,
    []
  );
  const nextGenRaw = subRes.rows.map((row: any) => {
    const start = String(row.start_date).substring(0, 10);
    const duration = Math.max(1, Number(row.duration_days ?? 30));
    const since = daysBetween(start, today);
    const cyclesPassed = since < 0 ? 0 : Math.floor(since / duration);
    const nextDateIso = addDays(start, (cyclesPassed + 1) * duration);
    return {
      name: String(row.full_name ?? "").trim(),
      memberId: String(row.member_id ?? ""),
      nextDateIso,
      dateLabel: formatDateShortIST(nextDateIso),
    };
  });
  nextGenRaw.sort((a, b) => a.nextDateIso.localeCompare(b.nextDateIso));
  const nextGen = nextGenRaw.map(({ name, memberId, dateLabel }) => ({ name, memberId, dateLabel }));

  // Summary: group upcoming generations within the next 7 days.
  const horizon = addDays(today, 7);
  const upcoming = new Map<string, number>();
  for (const r of nextGenRaw) {
    if (r.nextDateIso >= today && r.nextDateIso <= horizon) {
      upcoming.set(r.dateLabel, (upcoming.get(r.dateLabel) ?? 0) + 1);
    }
  }
  let nextGenSummary: string;
  if (upcoming.size > 0) {
    nextGenSummary = Array.from(upcoming.entries())
      .map(([d, c]) => `${d} — ${c}`)
      .join(", ");
  } else if (nextGenRaw.length > 0) {
    nextGenSummary = `Earliest ${nextGenRaw[0]!.dateLabel}`;
  } else {
    nextGenSummary = "No active members";
  }

  return {
    libraryName,
    dateLabel,
    presentCount,
    collectedTodayLabel,
    duesTotalLabel,
    duesCount: dues.length,
    nextGenSummary,
    shifts,
    paidToday,
    dues,
    nextGen,
  };
}

/**
 * Build the daily report PDF and WhatsApp it to every configured admin number as
 * a private document (Meta media upload) with a short summary body. Runs once a
 * day (11 PM IST cron). Returns the number of admins the report was sent to.
 */
export async function runDailyAdminReport(): Promise<number> {
  if (!whatsappConfig.enabled) {
    logger.info("WhatsApp disabled — daily admin report skipped");
    return 0;
  }
  const admins = await getAdminPhoneNumbers();
  if (admins.length === 0) {
    logger.warn("Daily admin report: no admin_whatsapp_numbers configured");
    return 0;
  }

  const data = await buildDailyReportData();
  const pdf = await buildDailyReportPdf(data);

  const dateForFile = istToday();
  const filename = `Daily-Report-${dateForFile}.pdf`;
  const mediaId = await uploadMediaToMeta(pdf, filename, "application/pdf");

  const variables = {
    "1": data.dateLabel,
    "2": `${data.presentCount} member(s)`,
    "3": data.collectedTodayLabel,
    "4": `${data.duesCount} member(s) • ${data.duesTotalLabel}`,
    "5": data.nextGenSummary,
  };

  let sent = 0;
  for (const phone of admins) {
    try {
      await sendDocumentTemplate(
        phone,
        TEMPLATES.DAILY_ADMIN_REPORT,
        TEMPLATE_LANGUAGE,
        variables,
        mediaId,
        filename
      );
      sent++;
    } catch (e: any) {
      logger.error({ err: e?.message, phone }, "Daily admin report send failed");
    }
  }
  logger.info({ sent, admins: admins.length }, "Daily admin report dispatched");
  return sent;
}
