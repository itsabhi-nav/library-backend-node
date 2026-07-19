import axios from "axios";
import FormData from "form-data";
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
  recipientId: number | null,
  headerImageId?: string | null
) {
  checkCircuitBreaker();
  const lang = templateLanguage || "en";
  if (!(await validateTemplate(templateName, lang, scope))) {
    throw new Error(`Template '${templateName}' not found or not approved (scope=${scope})`);
  }

  const formattedPhone = formatPhone(phone);
  const components = await buildTemplateComponents(templateName, lang, scope, variables, headerImageId);
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
    const metaCode = Number(e?.response?.data?.error?.code);
    recordApiResult(false, status);
    const errMsg = e?.response?.data?.error?.message ?? e.message;
    await SimpleDatabase.query(
      `INSERT INTO whatsapp_messages (
         org_id, recipient_phone, template_name, template_language,
         message_id, message_status, failure_reason, student_id, variables, sent_at
       ) VALUES ($1, $2, $3, $4, $5, 'failed', $6, $7, $8::jsonb, NOW())`,
      [scope, formattedPhone, templateName, lang, `failed_${Date.now()}`, errMsg, recipientId, JSON.stringify(variables)]
    );
    const err = new Error(errMsg) as Error & { permanent?: boolean };
    err.permanent = isPermanentMetaError(metaCode);
    throw err;
  }
}

// Meta errors that will never succeed on retry — policy caps, template problems,
// undeliverable numbers, invalid params. Retrying these only spams the message log
// (e.g. 131049 "healthy ecosystem engagement" marketing cap on every daily reset).
function isPermanentMetaError(code: number): boolean {
  if (!Number.isFinite(code)) return false;
  if (code === 131049 || code === 131047 || code === 131026 || code === 131051) return true;
  if (code === 100 || code === 133010) return true;
  if (code >= 132000 && code <= 132999) return true; // template not found/paused/mismatch
  return false;
}

export async function sendTemplateMessage(
  to: string,
  templateName: string,
  templateLanguage: string,
  variables: Record<string, unknown>,
  scopeKey?: string,
  recipientId?: number | null,
  skipQueue = false,
  headerImageId?: string | null
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
      { source: "individual_send", ...(headerImageId ? { headerImageId } : {}) },
      1
    );
    void processQueuedMessages();
    return;
  }

  return sendDirect(to, templateName, templateLanguage, variables, scope, recipientId ?? null, headerImageId);
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
    true,
    metadata?.headerImageId ?? null
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

// ── Document (media) template sends ─────────────────────────────────────────
// Used for the daily admin report: the full detail ships as a private PDF that
// is uploaded to Meta's media store (never a public URL) and referenced by id in
// a DOCUMENT header. Sent directly (not via the text queue) since it is a small,
// once-a-day admin-only broadcast.

/** Upload a file to the Meta media store and return its media id. */
export async function uploadMediaToMeta(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<string> {
  const url = `${whatsappConfig.baseUrl}/${whatsappConfig.apiVersion}/${whatsappConfig.phoneNumberId}/media`;
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimeType);
  form.append("file", buffer, { filename, contentType: mimeType });

  const res = await axios.post(url, form, {
    headers: { Authorization: `Bearer ${whatsappConfig.accessToken}`, ...form.getHeaders() },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
  const id = res.data?.id;
  if (!id) throw new Error("Meta media upload returned no media id");
  return String(id);
}

/** Send a template whose header is a document (by media id), plus body variables. */
export async function sendDocumentTemplate(
  to: string,
  templateName: string,
  templateLanguage: string,
  variables: Record<string, unknown>,
  mediaId: string,
  filename: string,
  scopeKey?: string,
  recipientId?: number | null
): Promise<string | undefined> {
  if (!whatsappConfig.enabled) {
    logger.warn({ to }, "WhatsApp disabled — skipping document send");
    return;
  }
  const scope = scopeKey ?? SCOPE_KEY;
  const lang = templateLanguage || "en";
  if (!(await validateTemplate(templateName, lang, scope))) {
    throw new Error(`Template '${templateName}' not found or not approved (scope=${scope})`);
  }

  const formattedPhone = formatPhone(to);
  const bodyParams = Object.entries(variables)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => ({ type: "text", text: String(v) }));
  const components: object[] = [
    {
      type: "header",
      parameters: [{ type: "document", document: { id: mediaId, filename } }],
    },
  ];
  if (bodyParams.length > 0) components.push({ type: "body", parameters: bodyParams });

  const url = `${whatsappConfig.baseUrl}/${whatsappConfig.apiVersion}/${whatsappConfig.phoneNumberId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: formattedPhone,
    type: "template",
    template: { name: templateName, language: { code: lang }, components },
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
      [scope, formattedPhone, templateName, lang, messageId, recipientId ?? null, JSON.stringify(variables)]
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
      [scope, formattedPhone, templateName, lang, `failed_${Date.now()}`, errMsg, recipientId ?? null, JSON.stringify(variables)]
    );
    throw new Error(errMsg);
  }
}

// ── Meta status webhook ─────────────────────────────────────────────────────
// A successful send only means Meta *accepted* the message ('sent'). The real
// lifecycle (delivered / read / failed) arrives asynchronously on the webhook.
// Without consuming it, every row is stuck at 'sent' even when the phone never
// received it. This processes those callbacks and reconciles the true status.

/** Apply a single Meta status object to its matching message row. */
async function updateMessageStatus(status: any): Promise<void> {
  const messageId = status?.id;
  const newStatus = status?.status; // sent | delivered | read | failed
  if (!messageId || !newStatus) return;

  // Meta attaches an errors[] array on a failed status.
  const err = Array.isArray(status.errors) ? status.errors[0] : null;
  const failureReason = err
    ? `${err.code ?? ""} ${err.title ?? ""}${err.message ? " — " + err.message : ""}`.trim()
    : null;

  try {
    const res = await SimpleDatabase.query(
      // Never downgrade a message (read is terminal; don't drop delivered→sent),
      // but always allow a terminal 'failed' to be recorded.
      `UPDATE whatsapp_messages
       SET message_status = CASE
             WHEN message_status = 'read' THEN 'read'
             WHEN message_status = 'delivered' AND $1 = 'sent' THEN 'delivered'
             ELSE $1 END,
           delivered_at = CASE WHEN $1 IN ('delivered', 'read') AND delivered_at IS NULL THEN NOW() ELSE delivered_at END,
           read_at = CASE WHEN $1 = 'read' AND read_at IS NULL THEN NOW() ELSE read_at END,
           failed_at = CASE WHEN $1 = 'failed' AND failed_at IS NULL THEN NOW() ELSE failed_at END,
           failure_reason = CASE WHEN $1 = 'failed' THEN COALESCE($3, failure_reason) ELSE failure_reason END,
           updated_at = NOW()
       WHERE message_id = $2`,
      [newStatus, messageId, failureReason]
    );
    if (res.rowCount === 0) {
      logger.warn({ messageId, newStatus }, "WhatsApp webhook status: message_id not found");
    } else {
      logger.info({ messageId, newStatus, failureReason }, "WhatsApp message status updated via webhook");
    }
  } catch (e: any) {
    logger.error({ err: e?.message, messageId }, "Failed to update WhatsApp message status from webhook");
  }
}

/** Handle a full Meta webhook payload (status updates + inbound messages). */
export async function processWebhookEvent(event: any): Promise<void> {
  const entries = Array.isArray(event?.entry) ? event.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      if (change?.field !== "messages") continue;
      const statuses = change?.value?.statuses;
      if (Array.isArray(statuses)) {
        for (const status of statuses) {
          await updateMessageStatus(status);
        }
      }
    }
  }
}

export { whatsappConfig };
