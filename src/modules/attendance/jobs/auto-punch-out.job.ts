import cron, { ScheduledTask } from "node-cron";
import { logger } from "../../../config/logger";
import { autoPunchOutEndedShifts } from "../attendance.service";
import * as bookingRepo from "../../booking/booking.repository";

// One cron per unique shift end time — NOT a per-minute poll — so the DB can stay
// idle (and Neon can auto-suspend) between shift ends. rescheduleAutoPunchOut() is
// re-run whenever shifts change, so add/edit/delete takes effect without a restart.
let tasks: ScheduledTask[] = [];

export async function rescheduleAutoPunchOut(): Promise<void> {
  for (const t of tasks) {
    try {
      t.stop();
    } catch {
      /* ignore */
    }
  }
  tasks = [];

  const rows = await bookingRepo.findAllShifts();
  const endTimes = new Set<string>();
  for (const s of rows) {
    if (s.is_active === false) continue;
    endTimes.add(String(s.end_time).substring(0, 5));
  }

  for (const end of endTimes) {
    const [hh, mm] = end.split(":");
    const hour = parseInt(hh ?? "0", 10);
    const minute = parseInt(mm ?? "0", 10);
    const task = cron.schedule(
      `${minute} ${hour} * * *`,
      async () => {
        try {
          const count = await autoPunchOutEndedShifts();
          if (count > 0) logger.info({ end, count }, "Auto punch-out at shift end");
        } catch (error) {
          logger.error({ error, end }, "Auto punch-out job failed");
        }
      },
      { timezone: "Asia/Kolkata" }
    );
    tasks.push(task);
  }

  logger.info({ shiftEndTimes: endTimes.size }, "Auto punch-out schedules (re)built (IST)");
}

export async function startAutoPunchOutJob(): Promise<void> {
  // Boot catch-up: if the server was down at a shift end time, punch out anyone
  // still stranded now — then arm the per-shift-end crons.
  try {
    await autoPunchOutEndedShifts();
  } catch (error) {
    logger.error({ error }, "Auto punch-out boot catch-up failed");
  }
  await rescheduleAutoPunchOut();
}
