import { SimpleDatabase } from "../../core/database/SimpleDatabase";
import { AppError } from "../../core/errors/AppError";
import { hashPassword, verifyPassword, needsPasswordRehash } from "../../shared/password";
import { generateToken } from "../../shared/token";
import { generateNextMemberId } from "../../shared/memberId";
import { serializeUser } from "../../shared/serializers";
import { springPage } from "../../shared/springPage";
import { istToday, addDays } from "../../shared/ist";
import { notifyAdmissionIfNeeded } from "../whatsapp/admission.service";
import { notifyNewMemberFromUserId, DEFAULT_EXAM_NAME } from "../whatsapp/library-notifications.service";
import { validateSeatForAssignment } from "../booking/booking.service";
import { insertInvoice } from "../fees/fees.repository";
import * as repo from "./auth.repository";
import type { RegisterInput, StudentRegisterInput } from "./auth.validator";

function normalizeMemberId(memberId: string): string {
  return memberId.trim().toUpperCase().replace(/-/g, "").replace(/ /g, "");
}

/** findByMemberId: normalized match first, then exact trimmed fallback. */
export async function findByMemberId(memberId: string) {
  if (!memberId || memberId.trim() === "") return null;
  const normalized = normalizeMemberId(memberId);
  const byNorm = await repo.findByMemberIdNormalized(normalized);
  if (byNorm) return byNorm;
  return repo.findByMemberIdExact(memberId.trim());
}

export async function authenticate(memberIdRaw: string, password: string) {
  const memberId = memberIdRaw ? memberIdRaw.trim() : "";
  const user = await findByMemberId(memberId);
  if (!user) throw AppError.badRequest("Invalid Member ID or password");

  if (user.is_active !== true) {
    throw AppError.badRequest("Account is deactivated. Please contact the admin.");
  }
  if (!verifyPassword(password, user.password_hash)) {
    throw AppError.badRequest("Invalid Member ID or password");
  }

  if (needsPasswordRehash(user.password_hash)) {
    await SimpleDatabase.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
      hashPassword(password),
      user.id,
    ]);
  }

  await SimpleDatabase.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]);

  const token = generateToken(Number(user.id), user.member_id, user.role);
  return {
    token,
    id: Number(user.id),
    memberId: user.member_id,
    fullName: user.full_name,
    role: user.role,
    phoneNumber: user.phone_number ?? null,
  };
}

export async function registerMember(input: RegisterInput) {
  if (await repo.existsByEmail(input.email)) {
    throw AppError.badRequest("Email already registered");
  }
  const inserted = await SimpleDatabase.query(
    `INSERT INTO users (email, full_name, password_hash, role, phone_number, is_active)
     VALUES ($1, $2, $3, 'MEMBER', $4, true)
     RETURNING ${repo.USER_COLUMNS}`,
    [input.email, input.fullName, hashPassword(input.password), input.phoneNumber ?? null]
  );
  return serializeUser(inserted.rows[0]);
}

async function validateSeatAssignment(
  client: any,
  seatId: number | null | undefined,
  excludeUserId: number | null,
  planId?: number | null,
  shiftId?: number | null
) {
  if (seatId == null) return;
  await validateSeatForAssignment(seatId, excludeUserId, planId, shiftId);
}

export async function registerStudent(input: StudentRegisterInput) {
  if (!input.fullName || input.fullName.trim() === "") {
    throw AppError.badRequest("Full name is required");
  }
  if (!input.phoneNumber || input.phoneNumber.trim() === "") {
    throw AppError.badRequest("Phone number is required");
  }

  const result = await SimpleDatabase.withTransaction(async (client) => {
    const memberId = await generateNextMemberId(client);
    const rawPassword =
      input.password && input.password.trim() !== "" ? input.password : input.phoneNumber!;

    let assignedSeat: any = null;
    if (input.seatId != null) {
      await validateSeatAssignment(client, input.seatId, null, input.planId ?? null, input.shiftId ?? null);
      assignedSeat = await repo.findSeatById(input.seatId, client);
    }

    const insertRes = await client.query(
      `INSERT INTO users (member_id, full_name, phone_number, address, dob, whatsapp_consent,
                          password_hash, role, is_active, assigned_seat_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'MEMBER', true, $8)
       RETURNING ${repo.USER_COLUMNS}`,
      [
        memberId,
        input.fullName,
        input.phoneNumber,
        input.address ?? null,
        input.dob ?? null,
        true,
        hashPassword(rawPassword),
        input.seatId ?? null,
      ]
    );
    const user = insertRes.rows[0];

    let planName = "No plan";
    let registrationFeeNotify: { userId: number; amount: number; year: number; month: number; dueDate: string } | null = null;
    if (input.planId != null) {
      const planRes = await client.query(
        `SELECT id, duration_days, price, name FROM membership_plans WHERE id = $1`,
        [input.planId]
      );
      if (planRes.rows.length === 0) throw AppError.badRequest(`Plan not found: ${input.planId}`);
      const plan = planRes.rows[0];
      planName = String(plan.name);
      const start = istToday();
      const end = addDays(start, Number(plan.duration_days));
      const subRes = await client.query(
        `INSERT INTO subscriptions (user_id, plan_id, start_date, end_date, status,
                                    paid_amount, payment_method, payment_status)
         VALUES ($1, $2, $3, $4, 'ACTIVE', 0, $5, 'PENDING')
         RETURNING id`,
        [user.id, plan.id, start, end, input.paymentMethod ?? "CASH"]
      );
      const subscriptionId = Number(subRes.rows[0].id);
      const year = parseInt(start.substring(0, 4), 10);
      const month = parseInt(start.substring(5, 7), 10);
      const graceDaysRes = await client.query(
        `SELECT config_value FROM library_config WHERE config_key = 'fee_due_grace_days' LIMIT 1`
      );
      const graceDays = graceDaysRes.rows[0]?.config_value
        ? parseInt(String(graceDaysRes.rows[0].config_value), 10)
        : 5;
      const dueDate = addDays(start, Number.isFinite(graceDays) ? graceDays : 5);
      await insertInvoice(
        {
          userId: Number(user.id),
          subscriptionId,
          billingYear: year,
          billingMonth: month,
          amount: Number(plan.price),
          planName: planName,
          dueDate,
          status: "PENDING",
          amountPaid: 0,
        },
        client
      );
      registrationFeeNotify = {
        userId: Number(user.id),
        amount: Number(plan.price),
        year,
        month,
        dueDate,
      };
    }

    const examDate = addDays(istToday(), 365);
    await client.query(
      `INSERT INTO user_exam_targets (user_id, exam_definition_id, custom_exam_name, custom_exam_date)
       VALUES ($1, NULL, $2, $3)`,
      [user.id, DEFAULT_EXAM_NAME, examDate]
    );

    return { user, assignedSeat, rawPassword, planName, registrationFeeNotify };
  });

  void notifyAdmissionIfNeeded(
    result.user.full_name,
    result.user.phone_number,
    Number(result.user.id)
  );
  void notifyNewMemberFromUserId(Number(result.user.id)).catch(() => {});
  if (result.registrationFeeNotify) {
    const { notifyFeesGenerated } = await import("../whatsapp/library-notifications.service");
    void notifyFeesGenerated(
      [{
        userId: result.registrationFeeNotify.userId,
        amount: result.registrationFeeNotify.amount,
        dueDate: result.registrationFeeNotify.dueDate,
      }],
      result.registrationFeeNotify.year,
      result.registrationFeeNotify.month
    ).catch(() => {});
  }

  // StudentRegisterResponse shape
  return {
    id: Number(result.user.id),
    memberId: result.user.member_id,
    fullName: result.user.full_name,
    phoneNumber: result.user.phone_number ?? null,
    address: result.user.address ?? null,
    role: result.user.role,
    assignedSeatNumber: result.assignedSeat ? result.assignedSeat.seat_number : null,
    defaultPassword: result.rawPassword,
  };
}

function validatePassword(password: string | null | undefined) {
  if (!password || password.length < 4) {
    throw AppError.badRequest("Password must be at least 4 characters");
  }
}

export async function setActiveStatus(userId: number, active: boolean) {
  const user = await repo.findById(userId);
  if (!user) throw AppError.badRequest("User not found");

  if (!active && user.role === "MEMBER") {
    const { punchOutUserIfActive } = await import("../attendance/attendance.service");
    await punchOutUserIfActive(userId);
  }

  const updated = await repo.updateUser(userId, { is_active: active });
  return serializeUserWithSeat(updated);
}

export async function resetPassword(userId: number, newPassword: string | null | undefined) {
  validatePassword(newPassword);
  const user = await repo.findById(userId);
  if (!user) throw AppError.badRequest("User not found");
  const updated = await repo.updateUser(userId, { password_hash: hashPassword(newPassword as string) });
  return serializeUserWithSeat(updated);
}

export async function deleteStudent(userId: number) {
  const user = await repo.findById(userId);
  if (!user) throw AppError.badRequest("User not found");
  if (user.role !== "MEMBER") throw AppError.badRequest("Only student records can be deleted");

  await SimpleDatabase.withTransaction(async (client) => {
    await client.query(
      `DELETE FROM fee_payments WHERE invoice_id IN (SELECT id FROM fee_invoices WHERE user_id = $1)`,
      [userId]
    );
    await client.query(`DELETE FROM fee_invoices WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM bookings WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM attendance WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM daily_attendance_summary WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM daily_study_logs WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM user_achievements WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM user_monthly_goals WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM user_exam_targets WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM subscriptions WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  });
}

export async function changeOwnPassword(userId: number, currentPassword: string, newPassword: string) {
  validatePassword(newPassword);
  const user = await repo.findById(userId);
  if (!user) throw AppError.badRequest("User not found");
  if (!verifyPassword(currentPassword, user.password_hash)) {
    throw AppError.badRequest("Current password is incorrect");
  }
  if (verifyPassword(newPassword, user.password_hash)) {
    throw AppError.badRequest("New password must be different from the current password");
  }
  await SimpleDatabase.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
    hashPassword(newPassword),
    userId,
  ]);
}

export async function updateStudent(userId: number, input: StudentRegisterInput) {
  const updatedUser = await SimpleDatabase.withTransaction(async (client) => {
    const existing = await repo.findById(userId);
    if (!existing) throw AppError.badRequest("User not found");

    const fields: Record<string, any> = {};
    if (input.fullName != null && input.fullName.trim() !== "") fields.full_name = input.fullName;
    if (input.phoneNumber != null && input.phoneNumber.trim() !== "") fields.phone_number = input.phoneNumber;
    if (input.address != null) fields.address = input.address;
    if (input.dob != null) fields.dob = input.dob;
    fields.whatsapp_consent = true;

    if (input.assignSeat === true) {
      if (input.seatId != null) {
        const subRes = await client.query(
          `SELECT plan_id FROM subscriptions WHERE user_id = $1 AND status = 'ACTIVE'
           AND CURRENT_DATE BETWEEN start_date AND end_date LIMIT 1`,
          [userId]
        );
        const activePlanId = subRes.rows[0]?.plan_id != null ? Number(subRes.rows[0].plan_id) : null;
        await validateSeatAssignment(client, input.seatId, userId, input.planId ?? activePlanId);
        fields.assigned_seat_id = input.seatId;
      } else {
        fields.assigned_seat_id = null;
      }
    } else if (input.seatId != null) {
      const subRes = await client.query(
        `SELECT plan_id FROM subscriptions WHERE user_id = $1 AND status = 'ACTIVE'
         AND CURRENT_DATE BETWEEN start_date AND end_date LIMIT 1`,
        [userId]
      );
      const activePlanId = subRes.rows[0]?.plan_id != null ? Number(subRes.rows[0].plan_id) : null;
      await validateSeatAssignment(client, input.seatId, userId, input.planId ?? activePlanId);
      fields.assigned_seat_id = input.seatId;
    }

    return repo.updateUser(userId, fields, client);
  });

  void notifyAdmissionIfNeeded(
    updatedUser.full_name,
    updatedUser.phone_number,
    Number(updatedUser.id)
  );
  void notifyNewMemberFromUserId(Number(updatedUser.id)).catch(() => {});

  return serializeUserWithSeat(updatedUser);
}

export async function getUserJson(userId: number) {
  const user = await repo.findById(userId);
  if (!user) return null;
  return serializeUserWithSeat(user);
}

export async function findByEmailJson(email: string) {
  const user = await repo.findByEmail(email);
  if (!user) return null;
  return serializeUserWithSeat(user);
}

export async function findByMemberIdJson(memberId: string) {
  const user = await findByMemberId(memberId);
  if (!user) return null;
  return serializeUserWithSeat(user);
}

export async function getAllMembers() {
  const rows = await repo.findAllMembers();
  return serializeUsersWithSeats(rows);
}

export async function getAllUsers() {
  const rows = await repo.findAllOrderByCreatedAtDesc();
  return serializeUsersWithSeats(rows);
}

export async function searchStudents(search: string | null, statusRaw: string, page: number, size: number) {
  const status = !statusRaw || statusRaw.trim() === "" ? "all" : statusRaw.toLowerCase();
  const { rows, total } = await repo.searchStudents(search && search !== "" ? search : null, status, page, size);
  const content = await serializeUsersWithSeats(rows);
  return springPage(content, total, page, size);
}

// ---- helpers for embedding assignedSeat ----

async function serializeUserWithSeat(userRow: any) {
  if (!userRow) return null;
  let seat = null;
  if (userRow.assigned_seat_id != null) {
    seat = await repo.findSeatById(Number(userRow.assigned_seat_id));
  }
  return serializeUser(userRow, seat);
}

async function serializeUsersWithSeats(rows: any[]) {
  const seatMap = await repo.loadSeatsForUsers(rows);
  return rows.map((u) => serializeUser(u, u.assigned_seat_id != null ? seatMap.get(Number(u.assigned_seat_id)) : null));
}

