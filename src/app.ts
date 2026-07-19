import express from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";

import { logger } from "./config/logger";
import { corsOrigins } from "./config/env";
import { securityHeaders } from "./middlewares/securityHeaders";
import { errorMiddleware } from "./middlewares/errorMiddleware";

import { healthRouter } from "./modules/health/health.routes";
import { authRouter } from "./modules/auth/auth.routes";
import { bookingRouter } from "./modules/booking/booking.routes";
import { subscriptionsRouter } from "./modules/subscriptions/subscriptions.routes";
import { attendanceRouter } from "./modules/attendance/attendance.routes";
import { feesRouter } from "./modules/fees/fees.routes";
import { configRouter } from "./modules/config/config.routes";
import { goalsRouter } from "./modules/goals/goals.routes";
import { studyLogRouter } from "./modules/study-log/study-log.routes";
import { examsRouter } from "./modules/exams/exams.routes";
import { progressRouter } from "./modules/progress/progress.routes";
import { achievementsRouter } from "./modules/achievements/achievements.routes";
import { analyticsRouter } from "./modules/analytics/analytics.routes";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes";
import { studentOfTheMonthRouter } from "./modules/student-of-the-month/student-of-the-month.routes";
import { whatsappRouter } from "./modules/whatsapp/whatsapp.routes";
import { announcementRouter } from "./modules/announcement/announcement.routes";

export const createApp = () => {
  const app = express();

  // Behind Koyeb's proxy — needed for req.secure / correct client IP.
  app.set("trust proxy", 1);

  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === "/health" || req.url === "/" } }));

  // helmet with defaults; our securityHeaders middleware sets the exact set the
  // Java app sent (and overrides where they overlap).
  app.use(helmet({ contentSecurityPolicy: false }));

  // CORS — mirrors the Java CorsConfig: explicit origins, the three headers the
  // frontend sends, credentials on. Applied to /api/** (and harmless elsewhere).
  app.use(
    cors({
      origin: corsOrigins,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type", "X-Admin-Pin"],
      credentials: true,
    })
  );

  app.use(express.json({ limit: "256kb" }));
  app.use(express.urlencoded({ extended: true, limit: "256kb" }));
  app.use(securityHeaders);

  // Public health endpoints (no /api prefix) — must be mounted before any auth.
  app.use("/", healthRouter);

  // ---- API routers ----
  app.use("/api/auth", authRouter);
  app.use("/api", bookingRouter);
  app.use("/api", subscriptionsRouter);
  app.use("/api/attendance", attendanceRouter);
  app.use("/api/fees", feesRouter);
  app.use("/api/config", configRouter);
  app.use("/api/goals", goalsRouter);
  app.use("/api/study-log", studyLogRouter);
  app.use("/api/exams", examsRouter);
  app.use("/api/progress", progressRouter);
  app.use("/api/achievements", achievementsRouter);
  app.use("/api/analytics", analyticsRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/student-of-the-month", studentOfTheMonthRouter);
  app.use("/api/whatsapp", whatsappRouter);
  app.use("/api/announcement", announcementRouter);

  // Error handler must be last.
  app.use(errorMiddleware);

  return app;
};
