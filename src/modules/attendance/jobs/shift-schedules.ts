import { logger } from "../../../config/logger";
import { rescheduleAutoPunchOut } from "./auto-punch-out.job";
import { rescheduleAbsentReminder } from "../../whatsapp/jobs/absent-reminder.job";

/**
 * Re-arm every cron that depends on shift times (auto punch-out + absent reminder)
 * after a shift is added, edited or deleted — so schedule changes take effect
 * immediately without a backend restart. Fire-and-forget safe.
 */
export async function rescheduleShiftJobs(): Promise<void> {
  const results = await Promise.allSettled([rescheduleAutoPunchOut(), rescheduleAbsentReminder()]);
  for (const r of results) {
    if (r.status === "rejected") {
      logger.error({ err: r.reason }, "Failed to reschedule a shift-dependent job");
    }
  }
}
