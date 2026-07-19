import { createApp } from "./app";
import { env, getNumber } from "./config/env";
import { logger } from "./config/logger";
import { closeDatabaseConnections } from "./config/database";
import { SimpleDatabase } from "./core/database/SimpleDatabase";
import { validateProductionSecrets } from "./middlewares/validateProductionSecrets";
import { startFeeOverdueJob } from "./modules/fees/jobs/fee-overdue.job";
import { startAutoFeeGenerationJob } from "./modules/fees/jobs/fee-generation.job";
import { startWhatsAppMaintenanceJobs } from "./modules/whatsapp/jobs/maintenance.job";
import { startWhatsAppScheduledJobs } from "./modules/whatsapp/jobs/scheduled-notifications.job";
import { startAutoPunchOutJob } from "./modules/attendance/jobs/auto-punch-out.job";
import { startAbsentReminderJob } from "./modules/whatsapp/jobs/absent-reminder.job";
import { startAchievementEvaluationJob } from "./modules/achievements/jobs/achievement-evaluation.job";

validateProductionSecrets();

const app = createApp();
const port = getNumber(env.PORT, 8080);

const server = app.listen(port, async () => {
  logger.info(`Server running on port ${port}`);

  try {
    const isHealthy = await SimpleDatabase.isHealthy();
    logger.info(
      { status: isHealthy ? "healthy" : "unhealthy", database: isHealthy ? "connected" : "disconnected" },
      "Initial database health check"
    );
  } catch (error) {
    logger.error({ error }, "Initial health check failed");
  }

  startFeeOverdueJob();
  startAutoFeeGenerationJob();
  startWhatsAppMaintenanceJobs();
  startWhatsAppScheduledJobs();
  startAchievementEvaluationJob();
  void startAutoPunchOutJob().catch((error) => {
    logger.error({ error }, "Failed to start auto punch-out scheduler");
  });
  void startAbsentReminderJob().catch((error) => {
    logger.error({ error }, "Failed to start absent reminder scheduler");
  });
});

const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}, starting graceful shutdown`);
  server.close(async () => {
    try {
      await closeDatabaseConnections();
      logger.info("Graceful shutdown completed");
      process.exit(0);
    } catch (error) {
      logger.error({ error }, "Error during graceful shutdown");
      process.exit(1);
    }
  });
  setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 30000);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("uncaughtException", (error) => {
  logger.error({ error }, "Uncaught exception");
  gracefulShutdown("uncaughtException");
});
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled rejection");
});
