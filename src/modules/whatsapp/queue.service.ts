import { SimpleDatabase } from "../../core/database/SimpleDatabase";
import { whatsappConfig, SCOPE_KEY, newBatchId } from "./whatsapp.config";

export interface WhatsAppRecipient {
  phoneNumber: string;
  name?: string | null;
  id?: number | null;
  variables?: Record<string, unknown>;
}

let isProcessing = false;

export async function addMessagesToQueue(
  recipients: WhatsAppRecipient[],
  templateName: string,
  templateLanguage: string,
  orgId: string,
  batchId: string,
  metadata: Record<string, unknown>,
  priority: number
) {
  for (const r of recipients) {
    await SimpleDatabase.query(
      `INSERT INTO whatsapp_message_queue (
         org_id, template_name, template_language, phone_number,
         recipient_name, recipient_id, variables, scheduled_for,
         batch_id, metadata, priority
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW(), $8, $9::jsonb, $10)`,
      [
        orgId,
        templateName,
        templateLanguage,
        r.phoneNumber,
        r.name ?? null,
        r.id ?? null,
        JSON.stringify(r.variables ?? {}),
        batchId,
        JSON.stringify(metadata),
        priority,
      ]
    );
  }
  return { queuedCount: recipients.length, batchId };
}

export async function fetchPendingBatch(orgId?: string | null, batchId?: string | null) {
  const conditions = [`status = 'pending'`, `scheduled_for <= NOW()`];
  const params: unknown[] = [];
  let idx = 1;
  if (orgId) {
    conditions.push(`org_id = $${idx++}`);
    params.push(orgId);
  }
  if (batchId) {
    conditions.push(`batch_id = $${idx++}`);
    params.push(batchId);
  }
  const res = await SimpleDatabase.query(
    `SELECT * FROM whatsapp_message_queue WHERE ${conditions.join(" AND ")}
     ORDER BY priority ASC, created_at ASC LIMIT 100`,
    params
  );
  return res.rows;
}

export async function markQueueSent(id: number) {
  await SimpleDatabase.query(
    `UPDATE whatsapp_message_queue SET status = 'sent', sent_at = NOW() WHERE id = $1`,
    [id]
  );
}

export async function markQueueFailed(id: number, error: string, retries: number) {
  await SimpleDatabase.query(
    `UPDATE whatsapp_message_queue SET status = 'failed', error_message = $2, current_retries = $3 WHERE id = $1`,
    [id, error, retries]
  );
}

export async function resetFailedMessagesForRetry() {
  const res = await SimpleDatabase.query(
    `UPDATE whatsapp_message_queue SET status = 'pending', scheduled_for = NOW()
     WHERE status = 'failed' AND current_retries <= max_retries`,
    []
  );
  return res.rowCount ?? 0;
}

export async function cleanupOldQueueMessages(daysOld: number) {
  const res = await SimpleDatabase.query(
    `DELETE FROM whatsapp_message_queue
     WHERE status IN ('sent', 'failed')
       AND updated_at < NOW() - ($1 || ' days')::interval`,
    [daysOld]
  );
  return res.rowCount ?? 0;
}

export async function countDailySent(orgId: string, dayStart: Date) {
  const res = await SimpleDatabase.query(
    `SELECT COUNT(*)::int AS cnt FROM whatsapp_messages WHERE org_id = $1 AND sent_at > $2`,
    [orgId, dayStart]
  );
  return Number(res.rows[0]?.cnt ?? 0);
}

export async function processQueuedMessages(
  sendFn: (msg: any) => Promise<void>,
  orgId?: string | null,
  batchId?: string | null
) {
  if (isProcessing) return { processed: 0, sent: 0, failed: 0 };
  isProcessing = true;
  let totalProcessed = 0;
  let totalSent = 0;
  let totalFailed = 0;

  try {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);

    while (true) {
      const batch = await fetchPendingBatch(orgId, batchId);
      if (batch.length === 0) break;

      const countOrg = orgId ?? String(batch[0].org_id);
      let dailyCount = await countDailySent(countOrg, dayStart);

      for (let i = 0; i < batch.length; i++) {
        const msg = batch[i];
        if (dailyCount >= whatsappConfig.rateLimitPerDay) break;

        try {
          await sendFn(msg);
          await markQueueSent(Number(msg.id));
          totalSent++;
          dailyCount++;
        } catch (e: any) {
          totalFailed++;
          // Permanent Meta failures (marketing cap, template/policy errors) must
          // not be resurrected by the daily retry reset — push retries past the
          // max so resetFailedMessagesForRetry ignores them.
          const retries = e?.permanent === true
            ? 100000
            : Number(msg.current_retries ?? 0) + 1;
          await markQueueFailed(Number(msg.id), e?.message ?? "Send failed", retries);
        }
        totalProcessed++;
        const delay = Math.max(10, 1000 / whatsappConfig.rateLimitPerSecond);
        await new Promise((r) => setTimeout(r, delay));
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  } finally {
    isProcessing = false;
  }
  return { processed: totalProcessed, sent: totalSent, failed: totalFailed };
}

export { newBatchId, SCOPE_KEY, isProcessing };
