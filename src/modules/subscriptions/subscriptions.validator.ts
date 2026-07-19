import { z } from "zod";

export const planRequestSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  durationDays: z.number().optional(),
  price: z.number().optional(),
  shiftId: z.number().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const subscriptionRequestSchema = z.object({
  userId: z.number({ error: "userId is required" }),
  planId: z.number({ error: "planId is required" }),
  paidAmount: z.number({ error: "paidAmount is required" }),
  paymentMethod: z.string({ error: "paymentMethod is required" }),
  discountPercent: z.number().min(0).max(100).optional().nullable(),
});

export type PlanRequestInput = z.infer<typeof planRequestSchema>;
export type SubscriptionRequestInput = z.infer<typeof subscriptionRequestSchema>;
