import { Router } from "express";
import * as c from "./booking.controller";

export const bookingRouter = Router();

// Public read-only catalog
bookingRouter.get("/seats", c.getSeats);
bookingRouter.get("/shifts", c.getShifts);

// Staff only — contains member PII in booking payloads
bookingRouter.get("/bookings/date/:date", c.authenticate, c.requireAdminOrLibrarian, c.getBookingsByDate);

// Authenticated
bookingRouter.get("/seats/assignable", c.authenticate, c.requireAdminOrLibrarian, c.getAssignableSeats);
bookingRouter.post("/seats", c.authenticate, c.requireAdmin, c.addSeat);
bookingRouter.put("/seats/:id/status", c.authenticate, c.requireAdminOrLibrarian, c.updateSeatStatus);
bookingRouter.post("/seats/capacity", c.authenticate, c.requireAdmin, c.setSeatCapacity);

bookingRouter.post("/shifts", c.authenticate, c.requireAdmin, c.addShift);
bookingRouter.put("/shifts/:id", c.authenticate, c.requireAdmin, c.updateShift);
bookingRouter.delete("/shifts/:id/permanent", c.authenticate, c.requireAdmin, c.removeShift);
bookingRouter.delete("/shifts/:id", c.authenticate, c.requireAdmin, c.deleteShift);

bookingRouter.post("/bookings", c.authenticate, c.createBooking);
bookingRouter.delete("/bookings/:id", c.authenticate, c.cancelBooking);
bookingRouter.get("/bookings/my", c.authenticate, c.getMyBookings);
