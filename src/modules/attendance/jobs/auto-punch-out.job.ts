import cron from "node-cron";
import { logger } from "../../../config/logger";
import { autoPunchOutEndedShifts } from "../attendance.service";

/**
 * Every minute (IST): punch out anyone still punched in whose shift end time has
 * passed. Shifts are read live on each run, so adding / editing / deleting a
 * shift takes effect immediately — no backend restart needed — and a brief
 * downtime can't strand a member punched in (the next run catches them).
 */
export async function startAutoPunchOutJob(): Promise<void> {
  cron.schedule(
    "* * * * *",
    async () => {
      try {
        const count = await autoPunchOutEndedShifts();
        if (count > 0) logger.info({ count }, "Auto punch-out (shift ended)");
      } catch (error) {
        logger.error({ error }, "Auto punch-out job failed");
      }
    },
    { timezone: "Asia/Kolkata" }
  );

  logger.info("Auto punch-out scheduler started (every minute, IST)");
}
