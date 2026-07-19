/**
 * DB row -> JSON serializers that reproduce the exact shapes Jackson produced
 * for the Java entities, so the frontend sees identical payloads.
 *
 * Conventions:
 *  - snake_case columns -> camelCase fields
 *  - timestamps -> ISO strings (OffsetDateTime serialized as ISO-8601)
 *  - User.email and User.passwordHash were @JsonIgnore -> omitted
 *  - User.assignedSeat was an eager @ManyToOne -> nested Seat object (or null)
 */

export function toIsoOrNull(v: any): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export interface SeatRow {
  id: number | string;
  seat_number: string;
  status: string;
  has_power_outlet: boolean | null;
  created_at: any;
}

export function serializeSeat(row: SeatRow | null | undefined): any {
  if (!row) return null;
  return {
    id: Number(row.id),
    seatNumber: row.seat_number,
    status: row.status,
    hasPowerOutlet: row.has_power_outlet,
    createdAt: toIsoOrNull(row.created_at),
  };
}

/**
 * Serialize a users row. If the row was fetched with a LEFT JOIN to seats,
 * pass the joined seat columns via `seat` to embed assignedSeat.
 */
export function serializeUser(row: any, seat?: SeatRow | null): any {
  if (!row) return null;
  return {
    id: Number(row.id),
    memberId: row.member_id ?? null,
    // email and passwordHash intentionally omitted (@JsonIgnore in Java)
    fullName: row.full_name,
    role: row.role,
    phoneNumber: row.phone_number ?? null,
    address: row.address ?? null,
    dob: row.dob != null ? formatDate(row.dob) : null,
    whatsappConsent: row.whatsapp_consent,
    isActive: row.is_active,
    lastLoginAt: toIsoOrNull(row.last_login_at),
    assignedSeat: seat ? serializeSeat(seat) : null,
    createdAt: toIsoOrNull(row.created_at),
    // Present only on the admin student directory (from the enriched list query).
    currentShiftId: row.current_shift_id != null ? Number(row.current_shift_id) : null,
    discountPercent: row.current_discount_percent != null ? Number(row.current_discount_percent) : null,
  };
}

function formatDate(v: any): string {
  if (v == null) return v;
  if (v instanceof Date) return v.toISOString().substring(0, 10);
  return String(v).substring(0, 10);
}

function formatTime(v: any): string {
  if (v == null) return v;
  const s = String(v);
  return s.length >= 8 ? s.substring(0, 8) : s;
}

function toNumber(v: any): number {
  if (v == null) return 0;
  return Number(v);
}

/** Shift embedded in MembershipPlan omits createdAt (@JsonIgnoreProperties). */
export function serializeShiftForPlan(row: any): any {
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    startTime: formatTime(row.start_time),
    endTime: formatTime(row.end_time),
    price: row.price != null ? toNumber(row.price) : 0,
    isActive: row.is_active,
  };
}

export function serializeShift(row: any): any {
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    startTime: formatTime(row.start_time),
    endTime: formatTime(row.end_time),
    price: row.price != null ? toNumber(row.price) : 0,
    category: row.category ?? "MORNING",
    isActive: row.is_active,
    createdAt: toIsoOrNull(row.created_at),
  };
}

export function serializePlan(row: any, shiftRow?: any | null): any {
  if (!row) return null;
  const plan: any = {
    id: Number(row.id),
    name: row.name,
    description: row.description ?? null,
    durationDays: Number(row.duration_days),
    price: toNumber(row.price),
    isActive: row.is_active,
    createdAt: toIsoOrNull(row.created_at),
  };
  if (shiftRow) {
    plan.shift = serializeShiftForPlan(shiftRow);
  } else if (row.shift_id != null) {
    plan.shift = null;
  }
  return plan;
}

export function serializeSubscription(row: any, planRow?: any | null, planShiftRow?: any | null): any {
  if (!row) return null;
  const sub: any = {
    id: Number(row.id),
    startDate: formatDate(row.start_date),
    endDate: formatDate(row.end_date),
    status: row.status,
    paidAmount: toNumber(row.paid_amount),
    paymentMethod: row.payment_method ?? null,
    paymentStatus: row.payment_status,
    discountPercent: row.discount_percent != null ? toNumber(row.discount_percent) : 0,
    createdAt: toIsoOrNull(row.created_at),
  };
  if (planRow) {
    sub.plan = serializePlan(planRow, planShiftRow);
  }
  return sub;
}

export function serializeBooking(
  row: any,
  user?: any | null,
  seat?: SeatRow | null,
  shift?: any | null,
  subscription?: any | null
): any {
  if (!row) return null;
  const booking: any = {
    id: Number(row.id),
    bookingDate: formatDate(row.booking_date),
    status: row.status,
    createdAt: toIsoOrNull(row.created_at),
  };
  if (user) booking.user = serializeUser(user, user._assignedSeat ?? null);
  if (seat) booking.seat = serializeSeat(seat);
  if (shift) booking.shift = serializeShift(shift);
  if (subscription) booking.subscription = subscription;
  return booking;
}

export function serializeAttendance(
  row: any,
  user?: any | null,
  userSeat?: SeatRow | null,
  booking?: any | null
): any {
  if (!row) return null;
  const att: any = {
    id: Number(row.id),
    checkInTime: toIsoOrNull(row.check_in_time),
    checkOutTime: toIsoOrNull(row.check_out_time),
    createdAt: toIsoOrNull(row.created_at),
  };
  if (user) att.user = serializeUser(user, userSeat);
  if (booking) att.booking = booking;
  return att;
}

export function serializeFeeInvoice(row: any, user?: any | null, userSeat?: SeatRow | null): any {
  if (!row) return null;
  const inv: any = {
    id: Number(row.id),
    billingYear: Number(row.billing_year),
    billingMonth: Number(row.billing_month),
    amount: toNumber(row.amount),
    planName: row.plan_name ?? null,
    dueDate: formatDate(row.due_date),
    status: row.status,
    amountPaid: toNumber(row.amount_paid),
    generatedAt: toIsoOrNull(row.generated_at),
  };
  if (user) inv.user = serializeUser(user, userSeat);
  return inv;
}
