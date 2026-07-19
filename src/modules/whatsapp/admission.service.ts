import { SimpleDatabase } from "../../core/database/SimpleDatabase";
import { istToday } from "../../shared/ist";
import { whatsappConfig, SCOPE_KEY } from "./whatsapp.config";
import * as wa from "./whatsapp.service";

export async function hasAdmissionMessageBeenSent(userId: number): Promise<boolean> {
  // Only a *successful* send should block a re-send — otherwise a single failed
  // attempt (e.g. a bad header image) would permanently suppress the welcome
  // message for that member. Mirrors hasTemplateBeenSent().
  const res = await SimpleDatabase.query(
    `SELECT COUNT(*)::int AS cnt FROM whatsapp_messages
     WHERE student_id = $1 AND template_name = $2 AND message_status = 'sent'`,
    [userId, wa.TEMPLATE_NAME]
  );
  return Number(res.rows[0]?.cnt ?? 0) > 0;
}

export async function sendAdmissionConfirmation(memberName: string, phoneNumber: string, userId: number | null) {
  if (!whatsappConfig.enabled) {
    throw new Error("WhatsApp is disabled (set WHATSAPP_ENABLED=true)");
  }
  await wa.sendTemplateMessage(
    phoneNumber,
    wa.TEMPLATE_NAME,
    wa.TEMPLATE_LANGUAGE,
    { "1": memberName.trim() },
    SCOPE_KEY,
    userId,
    false
  );
}

export { TEMPLATE_NAME, TEMPLATE_LANGUAGE } from "./whatsapp.service";

export async function notifyAdmissionIfNeeded(
  memberName: string,
  phoneNumber: string | null | undefined,
  userId: number
): Promise<void> {
  if (!memberName || !phoneNumber) return;
  if (!whatsappConfig.enabled) return;
  if (await hasAdmissionMessageBeenSent(userId)) return;

  void sendAdmissionConfirmation(memberName, phoneNumber, userId).catch(() => {
    // fire-and-forget — matches Java async behaviour
  });
}

export { wa };
