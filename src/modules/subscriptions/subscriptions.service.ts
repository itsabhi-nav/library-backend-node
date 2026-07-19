import { AppError } from "../../core/errors/AppError";
import { SimpleDatabase } from "../../core/database/SimpleDatabase";
import { serializePlan, serializeSubscription } from "../../shared/serializers";
import { istToday, addDays } from "../../shared/ist";
import { normalizeDiscountPercent } from "../../shared/pricing";
import { TtlCache } from "../../shared/ttlCache";
import * as repo from "./subscriptions.repository";
import type { PlanRequestInput, SubscriptionRequestInput } from "./subscriptions.validator";

// The public plans list rarely changes; cache it and invalidate on any mutation.
const plansCache = new TtlCache<any[]>(60000);
const PLANS_CACHE_KEY = "active";
export function invalidatePlansCache() {
  plansCache.delete(PLANS_CACHE_KEY);
}

function serializePlanRow(row: any) {
  return serializePlan(row, repo.planRowToShift(row));
}

async function loadSubscriptionJson(row: any) {
  const planRow = row.plan_id ? await repo.findPlanById(Number(row.plan_id)) : null;
  const plan = planRow ? serializePlanRow(planRow) : null;
  const sub = serializeSubscription(row, planRow, repo.planRowToShift(planRow));
  if (plan) sub.plan = plan;
  return sub;
}

async function loadSubscriptionsJson(rows: any[]) {
  return Promise.all(rows.map((r) => loadSubscriptionJson(r)));
}

export async function getAllPlans() {
  const rows = await plansCache.getOrSet(PLANS_CACHE_KEY, () => repo.findActivePlans());
  return rows.map(serializePlanRow);
}

export async function getAllPlansAdmin() {
  return (await repo.findAllPlans()).map(serializePlanRow);
}

export async function createPlan(request: PlanRequestInput) {
  if (!request.name || request.name.trim() === "") {
    throw AppError.badRequest("Plan name is required");
  }
  if (request.durationDays == null) throw AppError.badRequest("durationDays is required");
  if (request.price == null) throw AppError.badRequest("price is required");

  if (request.shiftId != null) {
    const shift = await repo.findShiftById(request.shiftId);
    if (!shift) throw AppError.badRequest(`Shift not found: ${request.shiftId}`);
  }

  const row = await repo.insertPlan({
    name: request.name,
    description: request.description ?? null,
    durationDays: request.durationDays,
    price: request.price,
    shiftId: request.shiftId ?? null,
    isActive: request.isActive ?? true,
  });
  const full = await repo.findPlanById(Number(row.id));
  invalidatePlansCache();
  return serializePlanRow(full);
}

export async function updatePlan(id: number, request: PlanRequestInput) {
  const existing = await repo.findPlanById(id);
  if (!existing) throw AppError.badRequest(`Plan not found: ${id}`);

  const fields: Record<string, any> = {};
  if (request.name != null && request.name.trim() !== "") fields.name = request.name;
  if (request.description !== undefined) fields.description = request.description;
  if (request.durationDays != null) fields.duration_days = request.durationDays;
  if (request.price != null) fields.price = request.price;
  if (request.isActive != null) fields.is_active = request.isActive;

  if (request.shiftId != null) {
    const shift = await repo.findShiftById(request.shiftId);
    if (!shift) throw AppError.badRequest(`Shift not found: ${request.shiftId}`);
    fields.shift_id = request.shiftId;
  } else if (request.shiftId === null && request.name != null) {
    fields.shift_id = null;
  }

  await repo.updatePlanRow(id, fields);
  const full = await repo.findPlanById(id);
  invalidatePlansCache();
  return serializePlanRow(full);
}

export async function deactivatePlan(id: number) {
  const row = await repo.deactivatePlan(id);
  if (!row) throw AppError.badRequest(`Plan not found: ${id}`);
  invalidatePlansCache();
}

export async function getPlanStats() {
  const allPlans = await repo.findAllPlans();
  const today = istToday();
  // Fan out the per-plan aggregates in parallel instead of serially awaiting two
  // Neon round-trips per plan (previously O(plans) sequential latency).
  return Promise.all(
    allPlans.map(async (plan) => {
      const [count, revenue] = await Promise.all([
        repo.countActiveByPlanId(Number(plan.id), today),
        repo.sumRevenueByPlanId(Number(plan.id)),
      ]);
      return {
        planId: Number(plan.id),
        planName: plan.name,
        shiftName: plan.s_name ?? "All Shifts",
        activeSubscriberCount: count,
        totalRevenue: revenue,
      };
    })
  );
}

export async function createSubscription(request: SubscriptionRequestInput) {
  const user = await repo.findUserById(request.userId);
  if (!user) throw AppError.badRequest("User not found");

  const plan = await repo.findPlanById(request.planId);
  if (!plan) throw AppError.badRequest("Membership plan not found");

  const row = await SimpleDatabase.withTransaction(async (client) => {
    const today = istToday();
    await repo.cancelActiveSubscription(request.userId, today, client);
    const startDate = today;
    const endDate = addDays(startDate, Number(plan.duration_days));
    return repo.insertSubscription(
      {
        userId: request.userId,
        planId: request.planId,
        startDate,
        endDate,
        paidAmount: request.paidAmount,
        paymentMethod: request.paymentMethod,
        discountPercent: normalizeDiscountPercent(request.discountPercent),
      },
      client
    );
  });

  return loadSubscriptionJson(row);
}

export async function getActiveSubscription(userId: number) {
  const row = await repo.findActiveSubscriptionForUser(userId, istToday());
  if (!row) return null;
  return loadSubscriptionJson(row);
}

export async function getUserSubscriptions(userId: number) {
  return loadSubscriptionsJson(await repo.findSubscriptionsByUserId(userId));
}
