import { AppError } from "../../core/errors/AppError";
import { logger } from "../../config/logger";
import { whatsappConfig } from "../whatsapp/whatsapp.config";
import {
  TEMPLATES,
  queueTemplateMessages,
  loadAllLibraryBroadcastRecipients,
} from "../whatsapp/notify.helpers";
import { uploadMediaToMeta } from "../whatsapp/whatsapp.service";

const MAX_LEN = 900;
const MAX_OCCASION_LEN = 60;
const NAME_FALLBACK = "Member";

export type AnnouncementType = "text" | "image" | "festival";

export interface AnnouncementImage {
  buffer: Buffer;
  filename: string;
  mimetype: string;
}

export interface BroadcastInput {
  type: AnnouncementType;
  message?: string;
  occasion?: string;
  image?: AnnouncementImage;
}

/**
 * Broadcast an admin message to every active member + admin. Every template is
 * personalised with the recipient's name in {{1}}; {{2}} holds the announcement
 * body (text/image) or the festival occasion. Images are uploaded to Meta media
 * and attached as the header. Delivery runs through the rate-limited queue.
 */
export async function broadcastAnnouncement(input: BroadcastInput): Promise<{ recipients: number }> {
  if (!whatsappConfig.enabled) throw AppError.badRequest("WhatsApp is disabled");

  const type = input.type;
  const message = (input.message ?? "").trim();
  const occasion = (input.occasion ?? "").trim();

  if (type === "festival") {
    if (!occasion) throw AppError.badRequest("Festival occasion is required");
    if (occasion.length > MAX_OCCASION_LEN) {
      throw AppError.badRequest(`Occasion is too long (max ${MAX_OCCASION_LEN} characters)`);
    }
    if (!input.image) throw AppError.badRequest("Festival greeting requires an image");
  } else {
    if (!message) throw AppError.badRequest("Announcement message is required");
    if (message.length > MAX_LEN) {
      throw AppError.badRequest(`Announcement is too long (max ${MAX_LEN} characters)`);
    }
    if (type === "image" && !input.image) {
      throw AppError.badRequest("Image announcement requires an image");
    }
  }

  const recipients = await loadAllLibraryBroadcastRecipients();
  if (recipients.length === 0) return { recipients: 0 };

  const secondVar = type === "festival" ? occasion : message;
  const withVars = recipients.map((r) => ({
    ...r,
    variables: { "1": (r.name ?? "").trim() || NAME_FALLBACK, "2": secondVar },
  }));

  let template: string;
  let batchPrefix: string;
  let headerImageId: string | undefined;

  if (input.image) {
    headerImageId = await uploadMediaToMeta(input.image.buffer, input.image.filename, input.image.mimetype);
  }

  if (type === "festival") {
    template = TEMPLATES.FESTIVAL;
    batchPrefix = "festival";
  } else if (type === "image") {
    template = TEMPLATES.ANNOUNCEMENT_IMAGE;
    batchPrefix = "announcement_image";
  } else {
    template = TEMPLATES.ANNOUNCEMENT;
    batchPrefix = "announcement";
  }

  await queueTemplateMessages(
    withVars,
    template,
    batchPrefix,
    5,
    headerImageId ? { headerImageId } : undefined
  );

  logger.info({ recipients: withVars.length, type }, "Announcement broadcast queued");
  return { recipients: withVars.length };
}
