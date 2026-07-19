import { createHandler } from "../../core/http/createHandler";
import { AppError } from "../../core/errors/AppError";
import { env, isProduction } from "../../config/env";
import { logger } from "../../config/logger";
import { authenticate } from "../../middlewares/authMiddleware";
import { requireAdmin, requireAdminOrLibrarian } from "../../middlewares/requireRole";
import { whatsappConfig } from "./whatsapp.config";
import * as dashboard from "./dashboard.service";
import { sendAdmissionConfirmation, TEMPLATE_NAME } from "./admission.service";
import { processWebhookEvent } from "./whatsapp.service";

export const getMessages = createHandler(async (req, res) => {
  const page = parseInt(String(req.query.page ?? "1"), 10) || 1;
  const pageSize = parseInt(String(req.query.pageSize ?? "25"), 10) || 25;
  const search = req.query.search != null ? String(req.query.search) : null;
  const status = req.query.status != null ? String(req.query.status) : null;
  const templateName = req.query.templateName != null ? String(req.query.templateName) : null;
  res.status(200).json(await dashboard.getDashboardData(page, pageSize, search, status, templateName));
});

export const retryMessage = createHandler(async (req, res) => {
  if (!whatsappConfig.enabled) throw AppError.badRequest("WhatsApp is disabled (set WHATSAPP_ENABLED=true)");
  const id = parseInt(String(Array.isArray(req.params.messageId) ? req.params.messageId[0] : req.params.messageId), 10);
  try {
    await dashboard.retryFailedMessage(id);
    res.status(200).json({ message: "Message retry initiated successfully" });
  } catch (e: any) {
    if (e.message === "Failed message not found") throw AppError.notFound("Message not found");
    throw AppError.badRequest("Unable to retry message. Please try again later.");
  }
});

export const testAdmission = createHandler(async (req, res) => {
  if (isProduction) throw AppError.forbidden("Test endpoint disabled in production");
  if (!whatsappConfig.enabled) throw AppError.badRequest("WhatsApp is disabled (set WHATSAPP_ENABLED=true)");
  const phoneNumber = req.body?.phoneNumber as string | undefined;
  if (!phoneNumber?.trim()) throw AppError.badRequest("phoneNumber is required");
  const memberName = req.body?.memberName?.trim() || "Test Member";
  const userId = req.body?.userId != null ? Number(req.body.userId) : null;
  await sendAdmissionConfirmation(memberName, phoneNumber, userId);
  res.status(200).json({ message: "Admission WhatsApp queued", template: TEMPLATE_NAME });
});

// ── Meta webhook (public — no auth) ─────────────────────────────────────────

// GET: Meta calls this once to verify the callback URL during setup. Echo back
// hub.challenge only when the verify token matches ours.
export const verifyWebhook = createHandler(async (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const verifyToken = env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && verifyToken && token === verifyToken) {
    logger.info("WhatsApp webhook verified");
    res.status(200).send(String(challenge ?? ""));
    return;
  }
  logger.warn({ mode }, "WhatsApp webhook verification failed");
  res.status(403).json({ success: false, message: "Forbidden" });
});

// POST: Meta delivers message status updates (sent/delivered/read/failed) here.
// Always ack 200 quickly so Meta doesn't retry/disable the subscription.
export const processWebhook = createHandler(async (req, res) => {
  try {
    await processWebhookEvent(req.body);
  } catch (e: any) {
    logger.error({ err: e?.message }, "WhatsApp webhook processing failed");
  }
  res.status(200).json({ success: true });
});

export { authenticate, requireAdmin, requireAdminOrLibrarian };
