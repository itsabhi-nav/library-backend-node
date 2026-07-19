import cron from "node-cron";
import { logger } from "../../../config/logger";
import { whatsappConfig } from "../whatsapp.config";
import { isLastDayOfMonthIST } from "../../../shared/ist";
import {
  runFeeReminders,
  runSubscriptionExpiryReminders,
  runExamCountdownReminders,
  runStudentOfTheMonthNotifications,
} from "../library-notifications.service";

/** Scheduled WhatsApp notifications — all times IST (Asia/Kolkata). */
export function startWhatsAppScheduledJobs(): void {
  if (!whatsappConfig.enabled) {
    logger.info("WhatsApp disabled — scheduled notification crons not started");
    return;
  }

  // Fee reminders: DAILY at 12:00 PM IST. Sends to every active member who still
  // has an unpaid invoice (PENDING or OVERDUE), so a defaulter is nudged every day
  // until they pay or the invoice is waived — at which point they drop out of the
  // recipient set automatically (runFeeReminders filters PAID/WAIVED out).
  cron.schedule(
    "0 12 * * *",
    async () => {
      try {
        const count = await runFeeReminders();
        logger.info({ count }, "Fee reminder WhatsApp batch (daily)");
      } catch (error) {
        logger.error({ error }, "Fee reminder job failed (daily)");
      }
    },
    { timezone: "Asia/Kolkata" }
  );

  // Subscription expiry: daily 12:00 PM IST (last 10 days)
  cron.schedule(
    "0 12 * * *",
    async () => {
      try {
        const count = await runSubscriptionExpiryReminders();
        if (count > 0) {
          logger.info({ count }, "Subscription expiry WhatsApp reminders sent");
        }
      } catch (error) {
        logger.error({ error }, "Subscription expiry job failed");
      }
    },
    { timezone: "Asia/Kolkata" }
  );

  // Exam countdown: Tuesday & Saturday at 12:00 PM IST
  cron.schedule(
    "0 12 * * 2",
    async () => {
      try {
        const count = await runExamCountdownReminders();
        logger.info({ count, weekday: "Tuesday" }, "Exam countdown WhatsApp batch");
      } catch (error) {
        logger.error({ error }, "Exam countdown job failed (Tuesday)");
      }
    },
    { timezone: "Asia/Kolkata" }
  );

  cron.schedule(
    "0 12 * * 6",
    async () => {
      try {
        const count = await runExamCountdownReminders();
        logger.info({ count, weekday: "Saturday" }, "Exam countdown WhatsApp batch");
      } catch (error) {
        logger.error({ error }, "Exam countdown job failed (Saturday)");
      }
    },
    { timezone: "Asia/Kolkata" }
  );

  // Student of the Month: last day of month at 12:00 PM IST (full current month stats)
  cron.schedule(
    "0 12 * * *",
    async () => {
      if (!isLastDayOfMonthIST()) return;
      try {
        const count = await runStudentOfTheMonthNotifications();
        logger.info({ count }, "Student of the Month WhatsApp notifications (last day of month)");
      } catch (error) {
        logger.error({ error }, "Student of the Month job failed");
      }
    },
    { timezone: "Asia/Kolkata" }
  );

  // NOTE: the daily admin report + absent reminder are NOT fixed-time crons — they
  // fire relative to the last shift's end time and live in end-of-day.job.ts.

  logger.info("WhatsApp scheduled notification crons started (IST)");
}
