import { z } from "zod";

export const bookingRequestSchema = z.object({
  seatId: z.number({ error: "seatId is required" }),
  shiftId: z.number({ error: "shiftId is required" }),
  bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "bookingDate must be YYYY-MM-DD"),
});

export const shiftRequestSchema = z.object({
  name: z.string().optional(),
  startTime: z.string().min(1, "startTime is required"),
  endTime: z.string().min(1, "endTime is required"),
  price: z.number().min(0).optional(),
  category: z.enum(["MORNING", "EVENING", "FULL_DAY"]).optional(),
});

export const seatBodySchema = z.object({
  seatNumber: z.string().optional(),
  status: z.enum(["AVAILABLE", "OCCUPIED", "MAINTENANCE"]).optional(),
  hasPowerOutlet: z.boolean().optional(),
});

export type BookingRequestInput = z.infer<typeof bookingRequestSchema>;
export type ShiftRequestInput = z.infer<typeof shiftRequestSchema>;
