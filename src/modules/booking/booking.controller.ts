import { createHandler } from "../../core/http/createHandler";
import { AppError } from "../../core/errors/AppError";
import { authenticate } from "../../middlewares/authMiddleware";
import { requireAdmin, requireAdminOrLibrarian } from "../../middlewares/requireRole";
import { bookingRequestSchema, shiftRequestSchema, seatBodySchema } from "./booking.validator";
import * as svc from "./booking.service";

export const getSeats = createHandler(async (_req, res) => {
  res.status(200).json(await svc.getAllSeats());
});

export const getAssignableSeats = createHandler(async (req, res) => {
  const excludeRaw = req.query.excludeUserId;
  const excludeUserId =
    excludeRaw != null && String(excludeRaw) !== "" ? parseInt(String(excludeRaw), 10) : null;
  const shiftRaw = req.query.shiftId;
  const planRaw = req.query.planId;
  const shiftId =
    shiftRaw != null && String(shiftRaw) !== "" ? parseInt(String(shiftRaw), 10) : null;
  const planId =
    planRaw != null && String(planRaw) !== "" ? parseInt(String(planRaw), 10) : null;
  res.status(200).json(
    await svc.getAssignableSeats(
      Number.isNaN(excludeUserId!) ? null : excludeUserId,
      Number.isNaN(shiftId!) ? null : shiftId,
      Number.isNaN(planId!) ? null : planId
    )
  );
});

export const addSeat = createHandler(async (req, res) => {
  const body = seatBodySchema.parse(req.body ?? {});
  res.status(201).json(await svc.addSeat(body));
});

export const updateSeatStatus = createHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const status = String(req.query.status ?? "");
  if (!status) throw AppError.badRequest("status query param is required");
  res.status(200).json(await svc.updateSeatStatus(id, status));
});

export const getShifts = createHandler(async (_req, res) => {
  res.status(200).json(await svc.getAllShifts());
});

export const addShift = createHandler(async (req, res) => {
  const body = shiftRequestSchema.parse(req.body);
  res.status(201).json(await svc.addShift(body));
});

export const updateShift = createHandler(async (req, res) => {
  const body = shiftRequestSchema.parse(req.body);
  res.status(200).json(await svc.updateShift(parseId(req.params.id), body));
});

export const deleteShift = createHandler(async (req, res) => {
  await svc.deleteShift(parseId(req.params.id));
  res.status(204).send();
});

export const removeShift = createHandler(async (req, res) => {
  await svc.removeShift(parseId(req.params.id));
  res.status(204).send();
});

export const getBookingsByDate = createHandler(async (req, res) => {
  const date = String(req.params.date);
  res.status(200).json(await svc.getBookingsByDate(date));
});

export const createBooking = createHandler(async (req, res) => {
  const body = bookingRequestSchema.parse(req.body);
  res.status(201).json(await svc.createBooking(req.user!.userId, body));
});

export const cancelBooking = createHandler(async (req, res) => {
  res.status(200).json(await svc.cancelBooking(parseId(req.params.id), req.user!.userId));
});

export const getMyBookings = createHandler(async (req, res) => {
  res.status(200).json(await svc.getUserBookings(req.user!.userId));
});

export const setSeatCapacity = createHandler(async (req, res) => {
  const capacity = parseInt(String(req.query.capacity ?? ""), 10);
  if (Number.isNaN(capacity)) throw AppError.badRequest("capacity query param is required");
  await svc.bulkSetCapacity(capacity);
  res.status(200).send();
});

function parseId(raw: string | string[]): number {
  const id = parseInt(String(Array.isArray(raw) ? raw[0] : raw), 10);
  if (Number.isNaN(id)) throw AppError.badRequest("Invalid id");
  return id;
}

export { authenticate, requireAdmin, requireAdminOrLibrarian };
