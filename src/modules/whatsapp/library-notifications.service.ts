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

export async function notifyAchievementUnlocked(
  userId: number,
  title: string,
  description: string,
  earnedCount: number,
  totalCount: number
): Promise<void> {
  const user = await loadMemberUser(userId);
  if (!user) return;

  await sendToMemberIfConsent(userId, TEMPLATES.ACHIEVEMENT, {
    "1": String(user.full_name).trim(),
    "2": title,
    "3": description,
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
    recipients.push({
      phoneNumber: String(row.phone_number),
      id: Number(row.id),
      name: row.full_name,
      variables: {
        "1": String(row.full_name).trim(),
        "2": String(row.plan_name),
        "3": formatDateShortIST(endDate),
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
  const audience = await loadAllLibraryBroadcastRecipients();
  if (audience.length === 0) return 0;

  let queued = 0;
  for (const winner of data.winners) {
    if (!winner.userId || !winner.fullName || winner.value <= 0) continue;

    const already = await SimpleDatabase.query(
      `SELECT COUNT(*)::int AS cnt FROM whatsapp_messages
       WHERE template_name = $1
         AND variables->>'2' = $2 AND variables->>'3' = $3
         AND message_status IN ('sent', 'pending')`,
      [TEMPLATES.STUDENT_OF_MONTH, monthLabel, winner.categoryLabel]
    );
    if (Number(already.rows[0]?.cnt ?? 0) > 0) continue;

    const variables = {
      "1": String(winner.fullName).trim(),
      "2": monthLabel,
      "3": winner.categoryLabel,
      "4": winner.valueLabel,
    };

    const recipients = audience.map((r) => ({ ...r, variables }));
    await queueTemplateMessages(recipients, TEMPLATES.STUDENT_OF_MONTH, "student_of_month");
    queued += recipients.length;
  }

  return queued;
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
