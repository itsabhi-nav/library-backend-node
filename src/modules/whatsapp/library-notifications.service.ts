import { SimpleDatabase } from "../../core/database/SimpleDatabase";
import { formatBillingMonth, formatINRAmount, formatDateShortIST, istToday, istYear, istMonth, isLastDayOfMonthIST, daysBetween } from "../../shared/ist";
import {
  TEMPLATES,
  queueTemplateMessages,
  sendToMemberIfConsent,
  sendToAdmins,
  sendToMemberAndAdmins,
  loadMemberUser,
  hasTemplateBeenSent,
  hasReachablePhone,
  loadAllLibraryBroadcastRecipients,
  getPortalUrl,
} from "./notify.helpers";

export interface CreatedInvoiceNotify {
  userId: number;
  amount: number;
  dueDate: string;
  pendingAmount?: number;
}

export async function notifyFeesGenerated(
  created: CreatedInvoiceNotify[],
  year: number,
  month: number
): Promise<void> {
  if (created.length === 0) return;
  const monthLabel = formatBillingMonth(year, month);

  for (const inv of created) {
    const user = await loadMemberUser(inv.userId);
    if (!user) continue;
    const amountStr = formatINRAmount(inv.amount);
    const pending = inv.pendingAmount ?? inv.amount;
    const variables = {
      "1": String(user.full_name).trim(),
      "2": monthLabel,
      "3": amountStr,
      "4": formatINRAmount(pending),
      "5": formatDateShortIST(inv.dueDate),
    };

    if (hasReachablePhone(user)) {
      await queueTemplateMessages(
        [{
          phoneNumber: String(user.phone_number),
          id: Number(user.id),
          name: user.full_name,
          variables,
        }],
        TEMPLATES.FEE_GENERATED,
        "fee_generated"
      );
    }
    await sendToAdmins(TEMPLATES.FEE_GENERATED, variables);
  }
}

export async function notifyPaymentReceived(
  userId: number,
  amountPaid: number,
  billingYear: number,
  billingMonth: number,
  remaining: number
): Promise<void> {
  const user = await loadMemberUser(userId);
  if (!user) return;

  const monthLabel = formatBillingMonth(billingYear, billingMonth);
  const variables = {
    "1": String(user.full_name).trim(),
    "2": formatINRAmount(amountPaid),
    "3": monthLabel,
    "4": formatINRAmount(remaining),
  };

  await sendToMemberAndAdmins(userId, TEMPLATES.PAYMENT_RECEIVED, variables);
}

export async function runFeeReminders(): Promise<number> {
  const res = await SimpleDatabase.query(
    `SELECT fi.id, fi.user_id, fi.amount, fi.amount_paid, fi.status,
            fi.billing_year, fi.billing_month,
            u.full_name, u.phone_number
     FROM fee_invoices fi
     JOIN users u ON u.id = fi.user_id
     WHERE fi.status NOT IN ('PAID', 'WAIVED')
       AND fi.amount > fi.amount_paid
       AND u.role = 'MEMBER' AND u.is_active = true`,
    []
  );

  const recipients = [];
  for (const row of res.rows) {
    if (!row.phone_number) continue;
    const pending = Math.max(0, Number(row.amount) - Number(row.amount_paid));
    if (pending <= 0) continue;
    const monthLabel = formatBillingMonth(Number(row.billing_year), Number(row.billing_month));
    recipients.push({
      phoneNumber: String(row.phone_number),
      id: Number(row.user_id),
      name: row.full_name,
      variables: {
        "1": String(row.full_name).trim(),
        "2": monthLabel,
        "3": formatINRAmount(pending),
      },
    });
  }

  await queueTemplateMessages(recipients, TEMPLATES.FEE_REMINDER, "fee_reminder");
  return recipients.length;
}

/**
 * Send ONE combined "Achievement Unlocked" message covering every newly-earned
 * badge (names comma-separated), instead of one message per badge. The template
 * is a MARKETING category, so multiple rapid sends to the same member trip Meta's
 * per-user frequency cap (131049) and all but the first fail. Batching keeps it to
 * a single message.
 */
export async function notifyAchievementsUnlockedBatch(
  userId: number,
  titles: string[],
  descriptions: string[],
  earnedCount: number,
  totalCount: number
): Promise<void> {
  if (titles.length === 0) return;
  const user = await loadMemberUser(userId);
  if (!user) return;

  const titleList = titles.join(", ");
  const detail =
    titles.length === 1
      ? descriptions[0]?.trim() || ""
      : `You unlocked ${titles.length} new badges — keep it up!`;

  await sendToMemberIfConsent(userId, TEMPLATES.ACHIEVEMENT, {
    "1": String(user.full_name).trim(),
    "2": titleList,
    "3": detail,
    "4": String(earnedCount),
    "5": String(totalCount),
  });
}

export async function runSubscriptionExpiryReminders(): Promise<number> {
  const today = istToday();
  const res = await SimpleDatabase.query(
    `SELECT u.id, u.full_name, u.phone_number,
            s.end_date, p.name AS plan_name
     FROM users u
     JOIN subscriptions s ON s.user_id = u.id AND s.status = 'ACTIVE'
     JOIN membership_plans p ON p.id = s.plan_id
     WHERE u.role = 'MEMBER' AND u.is_active = true
       AND s.end_date >= $1::date
       AND s.end_date <= ($1::date + INTERVAL '10 days')`,
    [today]
  );

  const recipients = [];
  for (const row of res.rows) {
    if (!row.phone_number) continue;
    const endDate = String(row.end_date).substring(0, 10);
    const endDateLabel = formatDateShortIST(endDate);

    // Daily countdown over the last 10 days. We fold the "days left" into the
    // "valid until" value (variable 3) so no Meta template change is needed —
    // e.g. "30 Jun 2026 · 5 days left". Because that string changes every day,
    // the dedup below naturally allows one message per day (and blocks a repeat
    // on the same day), giving a real countdown instead of a single reminder.
    const daysLeft = Math.max(0, daysBetween(endDate, today));
    const countdown =
      daysLeft === 0 ? "expires today" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;
    const validUntilLabel = `${endDateLabel} · ${countdown}`;

    const already = await SimpleDatabase.query(
      `SELECT 1 FROM whatsapp_messages
       WHERE student_id = $1 AND template_name = $2
         AND variables->>'3' = $3
         AND message_status IN ('sent', 'pending', 'delivered', 'read') LIMIT 1`,
      [Number(row.id), TEMPLATES.SUBSCRIPTION_EXPIRY, validUntilLabel]
    );
    if (already.rows.length > 0) continue;

    recipients.push({
      phoneNumber: String(row.phone_number),
      id: Number(row.id),
      name: row.full_name,
      variables: {
        "1": String(row.full_name).trim(),
        "2": String(row.plan_name),
        "3": validUntilLabel,
      },
    });
  }

  await queueTemplateMessages(recipients, TEMPLATES.SUBSCRIPTION_EXPIRY, "subscription_expiry");
  return recipients.length;
}

const DEFAULT_EXAM_NAME = "Please set your exam from study log tab in my progress page";

export async function runExamCountdownReminders(): Promise<number> {
  const today = istToday();
  const res = await SimpleDatabase.query(
    `SELECT u.id, u.full_name, u.phone_number,
            uet.custom_exam_name, uet.custom_exam_date,
            ed.name AS def_name, ed.exam_date AS def_date
     FROM users u
     JOIN user_exam_targets uet ON uet.user_id = u.id
     LEFT JOIN exam_definitions ed ON ed.id = uet.exam_definition_id
     WHERE u.role = 'MEMBER' AND u.is_active = true`,
    []
  );

  const recipients = [];
  for (const row of res.rows) {
    if (!row.phone_number) continue;

    let examName = row.custom_exam_name ? String(row.custom_exam_name) : null;
    let examDate: string | null = row.custom_exam_date
      ? String(row.custom_exam_date).substring(0, 10)
      : null;
    if (!examName && row.def_name) {
      examName = String(row.def_name);
      examDate = row.def_date ? String(row.def_date).substring(0, 10) : null;
    }
    if (!examName || !examDate) continue;
    // Every member is seeded with a placeholder target at registration; don't
    // send a countdown until they've actually set a real exam.
    if (examName.trim() === DEFAULT_EXAM_NAME) continue;

    let daysLeft = daysBetween(examDate, today);
    if (daysLeft < 0) daysLeft = 0;

    recipients.push({
      phoneNumber: String(row.phone_number),
      id: Number(row.id),
      name: row.full_name,
      variables: {
        "1": String(row.full_name).trim(),
        "2": examName,
        "3": formatDateShortIST(examDate),
        "4": String(daysLeft),
      },
    });
  }

  await queueTemplateMessages(recipients, TEMPLATES.EXAM_COUNTDOWN, "exam_countdown");
  return recipients.length;
}

export async function notifyNewMemberRegistration(
  userId: number,
  memberName: string,
  memberId: string,
  planName: string,
  seatNumber: string | null,
  phoneNumber: string | null
): Promise<void> {
  if (!memberName || !phoneNumber) return;
  if (await hasTemplateBeenSent(userId, TEMPLATES.NEW_MEMBER)) return;

  const variables = {
    "1": memberName.trim(),
    "2": memberId,
    "3": planName || "—",
    "4": seatNumber?.replace(/^Seat-/i, "") ?? "Not assigned",
    "5": phoneNumber.replace(/\D/g, "").slice(-10),
    "6": await getPortalUrl(),
  };

  await queueTemplateMessages(
    [{ phoneNumber, id: userId, name: memberName, variables }],
    TEMPLATES.NEW_MEMBER,
    "new_member"
  );
  await sendToAdmins(TEMPLATES.NEW_MEMBER, variables);
}

export async function runStudentOfTheMonthNotifications(): Promise<number> {
  const { getStudentOfTheMonth } = await import("../student-of-the-month/student-of-the-month.service");
  const year = istYear();
  const month = istMonth();

  const data = await getStudentOfTheMonth(year, month);
  const monthLabel = formatBillingMonth(year, month);

  // Need at least one real winner to announce anything.
  if (!data.winners.some((w: any) => w.userId && w.value > 0)) return 0;

  // ONE combined broadcast per month for all three categories, so each member
  // gets a single MARKETING message instead of one per category (which tripped
  // Meta's per-user frequency cap). Dedup on the month label.
  const already = await SimpleDatabase.query(
    `SELECT 1 FROM whatsapp_messages
      WHERE template_name = $1 AND variables->>'1' = $2
        AND message_status IN ('sent', 'pending', 'delivered', 'read')
      LIMIT 1`,
    [TEMPLATES.SOTM_BROADCAST, monthLabel]
  );
  if (already.rows.length > 0) return 0;

  const byCategory = new Map<string, any>();
  for (const w of data.winners) byCategory.set(w.category, w);
  const nameOf = (cat: string) => {
    const w = byCategory.get(cat);
    return w?.userId && w.value > 0 ? String(w.fullName).trim() : "—";
  };
  const valueOf = (cat: string) => {
    const w = byCategory.get(cat);
    return w?.userId && w.value > 0 ? String(w.valueLabel) : "—";
  };

  const variables = {
    "1": monthLabel,
    "2": nameOf("HOURS"),
    "3": valueOf("HOURS"),
    "4": nameOf("ATTENDANCE"),
    "5": valueOf("ATTENDANCE"),
    "6": nameOf("STREAK"),
    "7": valueOf("STREAK"),
  };

  const audience = await loadAllLibraryBroadcastRecipients();
  if (audience.length === 0) return 0;
  const recipients = audience.map((r) => ({ ...r, variables }));
  await queueTemplateMessages(recipients, TEMPLATES.SOTM_BROADCAST, "sotm_broadcast");
  return recipients.length;
}

export async function notifyNewMemberFromUserId(userId: number): Promise<void> {
  if (await hasTemplateBeenSent(userId, TEMPLATES.NEW_MEMBER)) return;

  const res = await SimpleDatabase.query(
    `SELECT u.id, u.full_name, u.member_id, u.phone_number,
            s.seat_number,
            (SELECT p.name FROM subscriptions sub
             JOIN membership_plans p ON p.id = sub.plan_id
             WHERE sub.user_id = u.id AND sub.status = 'ACTIVE'
             ORDER BY sub.end_date DESC LIMIT 1) AS plan_name
     FROM users u
     LEFT JOIN seats s ON s.id = u.assigned_seat_id
     WHERE u.id = $1 LIMIT 1`,
    [userId]
  );
  const row = res.rows[0];
  if (!row) return;

  await notifyNewMemberRegistration(
    userId,
    row.full_name,
    row.member_id,
    row.plan_name ?? "No plan",
    row.seat_number ?? null,
    row.phone_number
  );
}

export { DEFAULT_EXAM_NAME };
