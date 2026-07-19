import { istYear, istMonth, monthStart, monthEnd, minutesToHours } from "../../shared/ist";
import { TtlCache } from "../../shared/ttlCache";

// Whole-library monthly aggregation is identical for every member, so cache the
// sorted base (without the per-user flag) for a short window to avoid recomputing
// the GROUP BY on every member's Home/Progress load.
const leaderboardBaseCache = new TtlCache<LeaderboardEntry[]>(60000);

export interface LeaderboardEntry {
  userId: number;
  memberId: string;
  fullName: string;
  daysPresent: number;
  totalMinutes: number;
  totalHours: number;
  currentUser: boolean;
  rank?: number;
  badge?: string | null;
}

export interface LeaderboardResponse {
  year: number;
  month: number;
  entries: LeaderboardEntry[];
  currentUserRank: number | null;
}

function resolveYearMonth(year?: number | null, month?: number | null): { year: number; month: number } {
  if (year != null && month != null) return { year, month };
  return { year: istYear(), month: istMonth() };
}

function badgeForRank(rank: number): string | null {
  if (rank === 1) return "GOLD";
  if (rank === 2) return "SILVER";
  if (rank === 3) return "BRONZE";
  return null;
}

/** Sorted, ranked entries for the month (no per-user flag) — cached per year:month. */
async function getLeaderboardBase(
  year: number,
  month: number,
  repo: typeof import("./attendance.repository")
): Promise<LeaderboardEntry[]> {
  return leaderboardBaseCache.getOrSet(`${year}-${month}`, async () => {
    const start = monthStart(year, month);
    const end = monthEnd(year, month);

    const [members, aggregates] = await Promise.all([
      repo.findAllMembers(),
      repo.aggregateMinutesByUserInRange(start, end),
    ]);
    const statsByUser = new Map<number, { minutes: number; days: number }>();
    for (const row of aggregates) {
      statsByUser.set(Number(row.user_id), { minutes: Number(row.minutes), days: Number(row.days) });
    }

    const entries: LeaderboardEntry[] = members.map((member) => {
      const stats = statsByUser.get(Number(member.id)) ?? { minutes: 0, days: 0 };
      return {
        userId: Number(member.id),
        memberId: member.member_id,
        fullName: member.full_name,
        daysPresent: stats.days,
        totalMinutes: stats.minutes,
        totalHours: minutesToHours(stats.minutes),
        currentUser: false,
      };
    });

    entries.sort((a, b) => {
      if (b.totalMinutes !== a.totalMinutes) return b.totalMinutes - a.totalMinutes;
      if (b.daysPresent !== a.daysPresent) return b.daysPresent - a.daysPresent;
      return a.fullName.toLowerCase().localeCompare(b.fullName.toLowerCase());
    });
    entries.forEach((entry, i) => {
      entry.rank = i + 1;
      entry.badge = badgeForRank(i + 1);
    });
    return entries;
  });
}

export async function buildLeaderboard(
  year: number,
  month: number,
  currentUserId: number | null,
  repo: typeof import("./attendance.repository")
): Promise<LeaderboardResponse> {
  const base = await getLeaderboardBase(year, month, repo);

  // Clone so the cached base is never mutated with a per-user flag.
  let currentUserRank: number | null = null;
  const entries: LeaderboardEntry[] = base.map((entry) => {
    const isCurrent = currentUserId != null && currentUserId === entry.userId;
    if (isCurrent) currentUserRank = entry.rank ?? null;
    return { ...entry, currentUser: isCurrent };
  });

  return { year, month, entries, currentUserRank };
}

/** Invalidate the leaderboard cache (call after attendance summary changes). */
export function invalidateLeaderboardCache(): void {
  leaderboardBaseCache.clear();
}

export async function getMonthlyStats(
  userId: number,
  year: number | null | undefined,
  month: number | null | undefined,
  repo: typeof import("./attendance.repository")
) {
  const ym = resolveYearMonth(year, month);

  // Everything we need (this user's minutes/days, rank, total students) is already
  // in the cached leaderboard — no extra per-user queries required.
  const leaderboard = await buildLeaderboard(ym.year, ym.month, userId, repo);
  const me = leaderboard.entries.find((e) => e.userId === userId);
  const totalMinutes = me?.totalMinutes ?? 0;
  const daysPresent = me?.daysPresent ?? 0;

  return {
    year: ym.year,
    month: ym.month,
    daysPresent,
    totalMinutes,
    totalHours: minutesToHours(totalMinutes),
    rank: leaderboard.currentUserRank,
    totalStudents: leaderboard.entries.length,
  };
}

export { resolveYearMonth };
