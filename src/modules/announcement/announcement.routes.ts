import { Router } from "express";
import multer from "multer";
import { authenticate } from "../../middlewares/authMiddleware";
import { requireAdmin } from "../../middlewares/requireRole";
import * as c from "./announcement.controller";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype?.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

export const announcementRouter = Router();

announcementRouter.post(
  "/broadcast",
  authenticate,
  requireAdmin,
  upload.single("image"),
  c.broadcast
);
