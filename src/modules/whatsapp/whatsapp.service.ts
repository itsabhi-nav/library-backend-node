import axios from "axios";
import { logger } from "../../config/logger";
import { SimpleDatabase } from "../../core/database/SimpleDatabase";
import { whatsappConfig, formatPhone, newBatchId, SCOPE_KEY } from "./whatsapp.config";
import { buildTemplateComponents } from "./template-components";
import * as queue from "./queue.service";

let consecutiveFailures = 0;
let lastFailureTime = 0;
const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_TIMEOUT_MS = 60_000;

export const TEMPLATE_NAME = "library_admission";
export const TEMPLATE_LANGUAGE = "en";

async function validateTemplate(templateName: string, templateLanguage: string, scope: string) {
  const res = await SimpleDatabase.query(
    `SELECT COUNT(*)::int AS cnt FROM whatsapp_templates
     WHERE template_name = $1 AND template_language = $2 AND org_id = $3 AND template_status = 'approved'`,
    [templateName, templateLanguage, scope]
  );
  return Number(res.rows[0]?.cnt ?? 0) > 0;
}

function checkCircuitBreaker() {
  const now = Date.now();
  if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    if (now - lastFailureTime < CIRCUIT_BREAKER_TIMEOUT_MS) {
      throw new Error("Circuit breaker is open. Too many consecutive API failures.");
    }
    consecutiveFailures = 0;
  }
}

function recordApiResult(success: boolean, status?: number) {
  if (success) {
    consecutiveFailures = 0;
    return;
  }
  if (status === 401 || status === 403 || status === 429 || (status != null && status >= 500)) {
    consecutiveFailures++;
    lastFailureTime = Date.now();
  }
}

async function sendDirect(
  phone: string,
  templateName: string,
  templateLanguage: string,
  variables: Record<string, unknown>,
  scope: string,
  recipientId: number | null
) {
  checkCircuitBreaker();
  const lang = templateLanguage || "en";
  if (!(await validateTemplate(templateName, lang, scope))) {
    throw new Error(`Template '${templateName}' not found or not approved (scope=${scope})`);
  }

  const formattedPhone = formatPhone(phone);
  const components = await buildTemplateComponents(templateName, lang, scope, variables);
  const url = `${whatsappConfig.baseUrl}/${whatsappConfig.apiVersion}/${whatsappConfig.phoneNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to: formattedPhone,
    type: "template",
    template: {
      name: templateName,
      language: { code: lang },
      components,
    },
  };

  try {
    const res = await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${whatsappConfig.accessToken}`, "Content-Type": "application/json" },
    });
    const messageId = res.data?.messages?.[0]?.id ?? `sent_${Date.now()}`;
    await SimpleDatabase.query(
      `INSERT INTO whatsapp_messages (
         org_id, recipient_phone, template_name, template_language,
         message_id, message_status, student_id, variables, sent_at
       ) VALUES ($1, $2, $3, $4, $5, 'sent', $6, $7::jsonb, NOW())`,
      [scope, formattedPhone, templateName, lang, messageId, recipientId, JSON.stringify(variables)]
    );
    recordApiResult(true);
    return messageId;
  } catch (e: any) {
    const status = e?.response?.status;
    recordApiResult(false, status);
    const errMsg = e?.response?.data?.error?.message ?? e.message;
    await SimpleDatabase.query(
      `INSERT INTO whatsapp_messages (
         org_id, recipient_phone, template_name, template_language,
         message_id, message_status, failure_reason, student_id, variables, sent_at
       ) VALUES ($1, $2, $3, $4, $5, 'failed', $6, $7, $8::jsonb, NOW())`,
      [scope, formattedPhone, templateName, lang, `failed_${Date.now()}`, errMsg, recipientId, JSON.stringify(variables)]
    );
    throw new Error(errMsg);
  }
}

export async function sendTemplateMessage(
  to: string,
  templateName: string,
  templateLanguage: string,
  variables: Record<string, unknown>,
  scopeKey?: string,
  recipientId?: number | null,
  skipQueue = false
) {
  if (!whatsappConfig.enabled) {
    logger.warn({ to }, "WhatsApp disabled — skipping send");
    return;
  }
  const scope = scopeKey ?? SCOPE_KEY;

  if (!skipQueue) {
    const batchId = newBatchId("single");
    await queue.addMessagesToQueue(
      [{ phoneNumber: to, variables, id: recipientId ?? null }],
      templateName,
      templateLanguage,
      scope,
      batchId,
      { source: "individual_send" },
      1
    );
    void processQueuedMessages();
    return;
  }

  return sendDirect(to, templateName, templateLanguage, variables, scope, recipientId ?? null);
}

export async function sendFromQueueMessage(msg: any) {
  const metadata = typeof msg.metadata === "string" ? JSON.parse(msg.metadata) : msg.metadata ?? {};
  const variables = typeof msg.variables === "string" ? JSON.parse(msg.variables) : msg.variables ?? {};
  await sendTemplateMessage(
    String(msg.phone_number),
    String(msg.template_name),
    String(msg.template_language),
    variables,
    String(msg.org_id),
    msg.recipient_id != null ? Number(msg.recipient_id) : null,
    true
  );
}

export async function processQueuedMessages() {
  if (!whatsappConfig.enabled) return;
  return queue.processQueuedMessages(sendFromQueueMessage, SCOPE_KEY, null);
}

export async function retryExistingMessage(
  existingDbId: number,
  to: string,
  templateName: string,
  templateLanguage: string,
  variables: Record<string, unknown>,
  scope: string,
  recipientId: number | null
) {
  if (!whatsappConfig.enabled) throw new Error("WhatsApp is disabled (set WHATSAPP_ENABLED=true)");
  checkCircuitBreaker();
  const lang = templateLanguage || TEMPLATE_LANGUAGE;
  if (!(await validateTemplate(templateName, lang, scope))) {
    throw new Error(`Template '${templateName}' not found or not approved`);
  }

  const formattedPhone = formatPhone(to);
  const url = `${whatsappConfig.baseUrl}/${whatsappConfig.apiVersion}/${whatsappConfig.phoneNumberId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: formattedPhone,
    type: "template",
    template: {
      name: templateName,
      language: { code: lang },
      components: await buildTemplateComponents(templateName, lang, scope, variables),
    },
  };

  const res = await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${whatsappConfig.accessToken}`, "Content-Type": "application/json" },
  });
  const messageId = res.data?.messages?.[0]?.id ?? `retry_${Date.now()}`;
  await SimpleDatabase.query(
    `UPDATE whatsapp_messages
     SET message_id = $1, message_status = 'sent', template_language = $2,
         variables = $3::jsonb, failure_reason = NULL, failed_at = NULL,
         sent_at = NOW(), updated_at = NOW()
     WHERE id = $4 AND org_id = $5`,
    [messageId, lang, JSON.stringify(variables), existingDbId, scope]
  );
  recordApiResult(true);
}

export async function cleanupOldQueueMessages(daysOld: number) {
  return queue.cleanupOldQueueMessages(daysOld);
}

export { whatsappConfig };
