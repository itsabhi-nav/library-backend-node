import { SimpleDatabase } from "../../core/database/SimpleDatabase";
import { whatsappConfig, SCOPE_KEY, newBatchId, formatPhone } from "./whatsapp.config";
import * as queue from "./queue.service";
import { processQueuedMessages } from "./whatsapp.service";

export const TEMPLATE_LANGUAGE = "en";

export const TEMPLATES = {
  PUNCH_IN: "library_punchin",
  PUNCH_OUT: "library_punchout",
  FEE_GENERATED: "library_fee_generated",
  PAYMENT_RECEIVED: "library_payment_received",
  FEE_REMINDER: "library_fee_reminder",
  ACHIEVEMENT: "library_achievement",
  SUBSCRIPTION_EXPIRY: "library_subscription_expiry",
  EXAM_COUNTDOWN: "library_exam_countdown",
  // Member + admin "membership confirmation" on registration. Upgraded from the
  // old library_admin_new_member body to include the library portal link ({{6}}).
  NEW_MEMBER: "library_membership_confirmation",
  STUDENT_OF_MONTH: "library_student_of_month",
  SOTM_BROADCAST: "library_sotm_broadcast",
  DAILY_ADMIN_REPORT: "library_daily_admin_report",
  ABSENT_REMINDER: "library_absent_reminder",
} as const;

/** Library portal URL used in WhatsApp messages (config override, sane default). */
export async function getPortalUrl(): Promise<string> {
  const res = await SimpleDatabase.query(
    `SELECT config_value FROM library_config WHERE config_key = 'library_portal_url' LIMIT 1`,
    []
  );
  const url = String(res.rows[0]?.config_value ?? "").trim();
  return url || "https://www.library.udayanpublicschool.co.in/";
}

export function hasReachablePhone(user: { phone_number?: string | null } | null | undefined): boolean {
  return Boolean(user?.phone_number && String(user.phone_number).trim());
}

export async function getAdminPhoneNumbers(): Promise<string[]> {
  const res = await SimpleDatabase.query(
    `SELECT config_value FROM library_config WHERE config_key = 'admin_whatsapp_numbers' LIMIT 1`,
    []
  );
  const raw = String(res.rows[0]?.config_value ?? "");
  return raw
    .split(",")
    .map((s) => formatPhone(s.trim()))
    .filter((s) => s.length >= 10);
}

export async function loadMemberUser(userId: number) {
  const res = await SimpleDatabase.query(
    `SELECT id, full_name, phone_number, member_id, whatsapp_consent
     FROM users WHERE id = $1 AND role = 'MEMBER' LIMIT 1`,
    [userId]
  );
  return res.rows[0] ?? null;
}

export async function hasTemplateBeenSent(userId: number, templateName: string): Promise<boolean> {
  const res = await SimpleDatabase.query(
    `SELECT COUNT(*)::int AS cnt FROM whatsapp_messages
     WHERE student_id = $1 AND template_name = $2 AND message_status = 'sent'`,
    [userId, templateName]
  );
  return Number(res.rows[0]?.cnt ?? 0) > 0;
}

export async function queueTemplateMessages(
  recipients: queue.WhatsAppRecipient[],
  templateName: string,
  batchPrefix: string,
  priority = 5
): Promise<void> {
  if (!whatsappConfig.enabled || recipients.length === 0) return;
  const batchId = newBatchId(batchPrefix);
  await queue.addMessagesToQueue(
    recipients,
    templateName,
    TEMPLATE_LANGUAGE,
    SCOPE_KEY,
    batchId,
    { source: batchPrefix },
    priority
  );
  void processQueuedMessages().catch(() => {});
}

/** All active library users with a phone, plus configured admin numbers (deduped by phone). */
export async function loadAllLibraryBroadcastRecipients(): Promise<queue.WhatsAppRecipient[]> {
  const res = await SimpleDatabase.query(
    `SELECT id, full_name, phone_number FROM users
     WHERE is_active = true AND phone_number IS NOT NULL AND TRIM(phone_number) <> ''`,
    []
  );
  const byPhone = new Map<string, queue.WhatsAppRecipient>();
  for (const row of res.rows) {
    const phone = String(row.phone_number).trim();
    byPhone.set(phone, {
      phoneNumber: phone,
      id: Number(row.id),
      name: row.full_name,
    });
  }
  const adminPhones = await getAdminPhoneNumbers();
  for (const phone of adminPhones) {
    if (!byPhone.has(phone)) {
      byPhone.set(phone, { phoneNumber: phone });
    }
  }
  return Array.from(byPhone.values());
}

export async function sendToMemberIfConsent(
  userId: number,
  templateName: string,
  variables: Record<string, unknown>
): Promise<void> {
  const user = await loadMemberUser(userId);
  if (!hasReachablePhone(user)) return;
  await queueTemplateMessages(
    [{ phoneNumber: String(user.phone_number), id: userId, name: user.full_name, variables }],
    templateName,
    templateName
  );
}

export async function sendToAdmins(
  templateName: string,
  variables: Record<string, unknown>
): Promise<void> {
  const phones = await getAdminPhoneNumbers();
  if (phones.length === 0) return;
  const recipients = phones.map((phone) => ({ phoneNumber: phone, variables }));
  await queueTemplateMessages(recipients, templateName, `admin_${templateName}`);
}

export async function sendToMemberAndAdmins(
  userId: number,
  templateName: string,
  variables: Record<string, unknown>
): Promise<void> {
  await sendToMemberIfConsent(userId, templateName, variables);
  await sendToAdmins(templateName, variables);
}
