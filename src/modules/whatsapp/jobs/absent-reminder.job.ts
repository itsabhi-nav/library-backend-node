import cron, { ScheduledTask } from "node-cron";
import { logger } from "../../../config/logger";
import { whatsappConfig } from "../whatsapp.config";
import * as bookingRepo from "../../booking/booking.repository";
import { runAbsentReminders } from "../library-notifications.service";

// Fires ~2 minutes after the LAST active shift's end time (so every shift — morning,
// evening, full-day — is over and auto punch-out has run). Re-scheduled whenever
// shifts change, so it always tracks the real last-shift time without a restart.
let task: ScheduledTask | null = null;

export async function rescheduleAbsentReminder(): Promise<void> {
  if (task) {
    try {
      task.stop();
    } catch {
      /* ignore */
    }
    task = null;
  }
  if (!whatsappConfig.enabled) return;

  const rows = await bookingRepo.findAllShifts();
  let maxEnd = -1;
  for (const s of rows) {
    if (s.is_active === false) continue;
    const [hh, mm] = String(s.end_time).substring(0, 5).split(":");
    const mins = parseInt(hh ?? "0", 10) * 60 + parseInt(mm ?? "0", 10);
    if (mins > maxEnd) maxEnd = mins;
  }
  if (maxEnd < 0) {
    logger.info("No active shifts — absent reminder not scheduled");
    return;
  }

  const total = (maxEnd + 2) % (24 * 60);
  const hour = Math.floor(total / 60);
  const minute = total % 60;

  task = cron.schedule(
    `${minute} ${hour} * * *`,
    async () => {
      try {
        const count = await runAbsentReminders();
        logger.info({ count }, "Absent reminder WhatsApp batch");
      } catch (error) {
        logger.error({ error }, "Absent reminder job failed");
      }
    },
    { timezone: "Asia/Kolkata" }
  );

  logger.info({ at: `${hour}:${String(minute).padStart(2, "0")} IST` }, "Absent reminder scheduled (after last shift)");
}

export function startAbsentReminderJob(): Promise<void> {
  return rescheduleAbsentReminder();
}
