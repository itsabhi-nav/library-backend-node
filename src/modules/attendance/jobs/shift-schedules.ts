import { logger } from "../../../config/logger";
import { rescheduleAutoPunchOut } from "./auto-punch-out.job";
import { rescheduleEndOfDayJobs } from "../../whatsapp/jobs/end-of-day.job";

/**
 * Re-arm every cron that depends on shift times (auto punch-out + end-of-day
 * absent reminder & daily report) after a shift is added, edited or deleted — so
 * schedule changes take effect immediately without a backend restart.
 */
export async function rescheduleShiftJobs(): Promise<void> {
  const results = await Promise.allSettled([rescheduleAutoPunchOut(), rescheduleEndOfDayJobs()]);
  for (const r of results) {
    if (r.status === "rejected") {
      logger.error({ err: r.reason }, "Failed to reschedule a shift-dependent job");
    }
  }
}
