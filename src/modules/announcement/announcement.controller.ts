import { createHandler } from "../../core/http/createHandler";
import { AppError } from "../../core/errors/AppError";
import { requirePin } from "../../middlewares/adminPin";
import * as svc from "./announcement.service";

export const broadcast = createHandler(async (req, res) => {
  requirePin(req.header("X-Admin-Pin"));

  const type = String(req.body?.type ?? "text") as svc.AnnouncementType;
  if (!["text", "image", "festival"].includes(type)) {
    throw AppError.badRequest("Invalid announcement type");
  }

  const message = req.body?.message != null ? String(req.body.message) : undefined;
  const occasion = req.body?.occasion != null ? String(req.body.occasion) : undefined;

  const file = (req as unknown as { file?: { buffer: Buffer; originalname?: string; mimetype?: string } }).file;
  const image = file
    ? {
        buffer: file.buffer,
        filename: file.originalname || "announcement.jpg",
        mimetype: file.mimetype || "image/jpeg",
      }
    : undefined;

  res.status(200).json(await svc.broadcastAnnouncement({ type, message, occasion, image }));
});
