import { Pool, PoolClient, types as pgTypes } from "pg";
import { buildDatabaseUrl, getNumber } from "./env";
import { logger } from "./logger";

// Return DATE (OID 1082) columns as raw 'YYYY-MM-DD' strings instead of JS Date
// objects. node-postgres otherwise parses them into local-midnight Dates, which
// shifts the calendar day under non-UTC machine timezones — we do all day logic
// in IST ourselves, so keep DATEs as plain strings.
pgTypes.setTypeParser(1082, (val) => val);

/**
 * PostgreSQL connection pool (Neon serverless).
 * Pool size mirrors the Java HikariCP config (maximum-pool-size=5).
 * Neon always requires SSL; we accept its cert chain via the explicit `ssl`
 * option below. We strip any `sslmode` query param from the URL so it doesn't
 * fight the explicit option (and to silence pg's verify-full deprecation note).
 */
const connectionString = buildDatabaseUrl()
  .replace(/([?&])sslmode=[^&]*&?/i, "$1")
  .replace(/[?&]$/, "");

export const pool = new Pool({
  connectionString,
  max: getNumber(process.env.DB_POOL_MAX, 20),
  // min:0 lets the pool drain to zero when idle so Neon's serverless compute can
  // auto-suspend — this is what keeps compute usage (and cost) low. We do NOT
  // keep the DB warm on a timer.
  min: 0,
  idleTimeoutMillis: 30000,
  // Long acquire timeout is the key to "no downtime, no manual refresh": when
  // Neon is suspended, the first request simply waits (up to 60s) for the
  // compute to wake instead of erroring. Cold requests are slow, never broken.
  connectionTimeoutMillis: getNumber(process.env.DB_CONNECTION_TIMEOUT_MS, 60000),
  ssl: { rejectUnauthorized: false },
});

pool.on("error", (err) => {
  logger.error({ err }, "Unexpected idle pg client error");
});

export const connectWithRetry = async (maxRetries = 3): Promise<PoolClient> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const client = await pool.connect();
      logger.debug(`Database connection established on attempt ${attempt}`);
      return client;
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries) {
      logger.error({ err: error, attempts: maxRetries }, "Failed to connect to database");
      throw error;
      }
      logger.warn({ err: error, attempt }, "Database connection failed, retrying");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw lastError;
};

export const checkDatabaseHealth = async (): Promise<boolean> => {
  try {
    const client = await connectWithRetry();
    await client.query("SELECT 1");
    client.release();
    return true;
  } catch (error) {
    logger.error({ err: error }, "Database health check failed");
    return false;
  }
};

export const closeDatabaseConnections = async (): Promise<void> => {
  try {
    await pool.end();
    logger.info("Database connections closed gracefully");
  } catch (error) {
    logger.error({ error }, "Error closing database connections");
    throw error;
  }
};
