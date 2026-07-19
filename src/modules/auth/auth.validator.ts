import { z } from "zod";

const nonBlank = (message: string) => z.string({ message }).trim().min(1, message);

export const loginSchema = z.object({
  memberId: nonBlank("Member ID is required"),
  password: nonBlank("Password is required"),
});

export const registerSchema = z.object({
  email: nonBlank("must not be blank").email("must be a well-formed email address"),
  password: nonBlank("must not be blank"),
  fullName: nonBlank("must not be blank"),
  phoneNumber: z.string().optional().nullable(),
});

export const changePasswordSchema = z.object({
  currentPassword: nonBlank("must not be blank"),
  newPassword: nonBlank("must not be blank"),
});

export const adminPinSchema = z.object({
  pin: nonBlank("must not be blank"),
});

export const passwordResetSchema = z.object({
  newPassword: z.string().optional().nullable(),
});

// Student register/update — all fields optional at the validation layer; the
// service enforces required-ness (fullName, phoneNumber) to mirror Java's
// IllegalArgumentException messages exactly.
export const studentRegisterSchema = z.object({
  fullName: z.string().optional().nullable(),
  phoneNumber: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date").optional().nullable(),
  whatsappConsent: z.boolean().optional().nullable(),
  planId: z.number().int().optional().nullable(),
  shiftId: z.number().int().optional().nullable(),
  assignSeat: z.boolean().optional().nullable(),
  seatId: z.number().int().optional().nullable(),
  paymentMethod: z.string().optional().nullable(),
  discountPercent: z.number().min(0).max(100).optional().nullable(),
  password: z.string().optional().nullable(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type StudentRegisterInput = z.infer<typeof studentRegisterSchema>;
