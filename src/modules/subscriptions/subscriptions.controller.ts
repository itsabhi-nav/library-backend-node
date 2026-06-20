import { createHandler } from "../../core/http/createHandler";
import { AppError } from "../../core/errors/AppError";
import { authenticate } from "../../middlewares/authMiddleware";
import { requireAdmin, requireAdminOrLibrarian } from "../../middlewares/requireRole";
import { planRequestSchema, subscriptionRequestSchema } from "./subscriptions.validator";
import * as svc from "./subscriptions.service";

export const getPlans = createHandler(async (_req, res) => {
  res.status(200).json(await svc.getAllPlans());
});

export const createPlan = createHandler(async (req, res) => {
  const body = planRequestSchema.parse(req.body);
  res.status(201).json(await svc.createPlan(body));
});

export const updatePlan = createHandler(async (req, res) => {
  const body = planRequestSchema.parse(req.body);
  res.status(200).json(await svc.updatePlan(parseId(req.params.id), body));
});

export const deletePlan = createHandler(async (req, res) => {
  await svc.deactivatePlan(parseId(req.params.id));
  res.status(204).send();
});

export const getPlanStats = createHandler(async (_req, res) => {
  res.status(200).json(await svc.getPlanStats());
});

export const getAllPlansAdmin = createHandler(async (_req, res) => {
  res.status(200).json(await svc.getAllPlansAdmin());
});

export const createSubscription = createHandler(async (req, res) => {
  const body = subscriptionRequestSchema.parse(req.body);
  const auth = req.user!;
  if (auth.role !== "ADMIN" && auth.role !== "LIBRARIAN" && auth.userId !== body.userId) {
    throw AppError.forbidden("Unauthorized action");
  }
  res.status(201).json(await svc.createSubscription(body));
});

export const getActiveSubscription = createHandler(async (req, res) => {
  const sub = await svc.getActiveSubscription(req.user!.userId);
  if (!sub) {
    const role = req.user!.role;
    if (role === "ADMIN" || role === "LIBRARIAN") {
      res.status(200).json(null);
      return;
    }
    throw AppError.notFound("No active subscription found");
  }
  res.status(200).json(sub);
});

export const getUserSubscriptions = createHandler(async (req, res) => {
  const userId = parseId(req.params.userId);
  const auth = req.user!;
  if (auth.role !== "ADMIN" && auth.role !== "LIBRARIAN" && auth.userId !== userId) {
    throw AppError.forbidden("Unauthorized action");
  }
  res.status(200).json(await svc.getUserSubscriptions(userId));
});

function parseId(raw: string | string[]): number {
  const id = parseInt(String(Array.isArray(raw) ? raw[0] : raw), 10);
  if (Number.isNaN(id)) throw AppError.badRequest("Invalid id");
  return id;
}

export { authenticate, requireAdmin, requireAdminOrLibrarian };
