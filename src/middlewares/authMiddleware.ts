import { Request, Response, NextFunction } from "express";
import { SimpleDatabase } from "../core/database/SimpleDatabase";
import { validateToken, TokenData } from "../shared/token";
import { AUTH_COOKIE, parseCookieHeader } from "../shared/authCookie";
import { AppError } from "../core/errors/AppError";
import { TtlCache } from "../shared/ttlCache";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: TokenData;
    }
  }
}

type ActiveUser = { userId: number; memberId: string; role: string };

/**
 * Short-lived cache of the per-request "is this user still active?" DB lookup.
 * Previously every authenticated request paid a full round-trip to Neon
 * (us-east-1) just to re-validate the user, adding hundreds of ms to every call.
 * A brief TTL keeps the "deactivated users lose access quickly" guarantee (within
 * ~30s) while eliminating that round-trip for the common case.
 */
const activeUserCache = new TtlCache<ActiveUser | null>(30000);

/** Drop a user from the auth cache immediately (call after deactivate/delete). */
export const invalidateAuthUser = (userId: number): void => {
  activeUserCache.delete(`u:${userId}`);
};

/**
 * Require a valid Bearer token and an active user record.
 * The active-user check is cached briefly (see activeUserCache) rather than
 * hitting the DB on every single request.
 */
export const authenticate = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const cookies = parseCookieHeader(req.header("Cookie"));
    const authHeader = req.header("Authorization");
    const cookieToken = cookies[AUTH_COOKIE];
    const bearerToken =
      authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const token = cookieToken || bearerToken;

    if (!token) {
      throw AppError.unauthorized("Missing or invalid authorization header");
    }
    const data = validateToken(token);
    if (!data) {
      throw AppError.unauthorized("Invalid or expired token");
    }

    const user = await activeUserCache.getOrSet(`u:${data.userId}`, async () => {
      const res = await SimpleDatabase.query(
        `SELECT id, member_id, role, is_active FROM users WHERE id = $1 LIMIT 1`,
        [data.userId]
      );
      const row = res.rows[0];
      if (!row || row.is_active !== true) return null;
      return {
        userId: Number(row.id),
        memberId: String(row.member_id),
        role: row.role,
      };
    });

    if (!user) {
      throw AppError.unauthorized("Invalid or expired token");
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};
