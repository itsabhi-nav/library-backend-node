import cron, { ScheduledTask } from "node-cron";
import { logger } from "../../../config/logger";
import { whatsappConfig } from "../whatsapp.config";
import * as bookingRepo from "../../booking/booking.repository";
import { runAbsentReminders } from "../library-notifications.service";
import { runDailyAdminReport } from "../../reports/daily-report.service";

// End-of-day jobs fire relative to the LAST active shift's end time (whichever
// shift — morning / evening / full-day — ends latest), so they always run once
// the library day is over:
//   • absent reminder     → last shift end + 2 min
//   • daily admin report  → last shift end + 5 min
// Re-scheduled whenever shifts change, so they track the real last-shift time
// without a backend restart.
let tasks: ScheduledTask[] = [];

function cronAtOffset(maxEndMin: number, offsetMin: number): string {
  const total = (maxEndMin + offsetMin) % (24 * 60);
  return `${total % 60} ${Math.floor(total / 60)} * * *`;
}

export async function rescheduleEndOfDayJobs(): Promise<void> {
  for (const t of tasks) {
    try {
      t.stop();
    } catch {
      /* ignore */
    }
  }
  tasks = [];
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
    logger.info("No active shifts — end-of-day jobs not scheduled");
    return;
  }

  const absentCron = cronAtOffset(maxEnd, 2);
  const reportCron = cronAtOffset(maxEnd, 5);

  tasks.push(
    cron.schedule(
      absentCron,
      async () => {
        try {
          const count = await runAbsentReminders();
          logger.info({ count }, "Absent reminder WhatsApp batch");
        } catch (error) {
          logger.error({ error }, "Absent reminder job failed");
        }
      },
      { timezone: "Asia/Kolkata" }
    )
  );

  tasks.push(
    cron.schedule(
      reportCron,
      async () => {
        try {
          const sent = await runDailyAdminReport();
          logger.info({ sent }, "Daily admin report WhatsApp dispatched");
        } catch (error) {
          logger.error({ error }, "Daily admin report job failed");
        }
      },
      { timezone: "Asia/Kolkata" }
    )
  );

  logger.info({ absentCron, reportCron }, "End-of-day jobs scheduled (IST, after last shift)");
}

export function startEndOfDayJobs(): Promise<void> {
  return rescheduleEndOfDayJobs();
}
