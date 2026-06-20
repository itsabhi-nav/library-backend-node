import { createHandler } from "../../core/http/createHandler";
import { AppError } from "../../core/errors/AppError";
import { requirePin } from "../../middlewares/adminPin";
import { setAuthCookie, clearAuthCookie } from "../../shared/authCookie";
import {
  loginSchema,
  registerSchema,
  changePasswordSchema,
  adminPinSchema,
  passwordResetSchema,
  studentRegisterSchema,
} from "./auth.validator";
import * as svc from "./auth.service";

// POST /api/auth/login  (public)
export const login = createHandler(async (req, res) => {
  const body = loginSchema.parse(req.body);
  // Java wraps auth failures as 401; our service throws 400-coded AppErrors, so remap.
  try {
    const response = await svc.authenticate(body.memberId, body.password);
    setAuthCookie(res, response.token);
    // Include token for cross-origin frontends (Netlify + Koyeb) where cookies are not sent.
    res.status(200).json(response);
  } catch (e) {
    if (e instanceof AppError && e.status === 400) {
      throw AppError.unauthorized(e.message);
    }
    throw e;
  }
});

// POST /api/auth/register  (ADMIN)
export const register = createHandler(async (req, res) => {
  const body = registerSchema.parse(req.body);
  const user = await svc.registerMember(body);
  res.status(201).json(user);
});

// GET /api/auth/me
export const getMe = createHandler(async (req, res) => {
  const user = await svc.getUserJson(req.user!.userId);
  if (!user) throw AppError.notFound("User not found");
  res.status(200).json(user);
});

// PUT /api/auth/me/password
export const changeOwnPassword = createHandler(async (req, res) => {
  const body = changePasswordSchema.parse(req.body);
  if (req.user!.role === "ADMIN") {
    requirePin(req.header("X-Admin-Pin"));
  }
  await svc.changeOwnPassword(req.user!.userId, body.currentPassword, body.newPassword);
  res.status(204).send();
});

// POST /api/auth/verify-admin-pin  (ADMIN/LIBRARIAN)
export const verifyAdminPin = createHandler(async (req, res) => {
  const body = adminPinSchema.parse(req.body);
  requirePin(body.pin);
  res.status(204).send();
});

// POST /api/auth/logout
export const logout = createHandler(async (_req, res) => {
  clearAuthCookie(res);
  res.status(204).send();
});

// GET /api/auth/members
export const getMembers = createHandler(async (_req, res) => {
  res.status(200).json(await svc.getAllMembers());
});

// GET /api/auth/users
export const getAllUsers = createHandler(async (_req, res) => {
  res.status(200).json(await svc.getAllUsers());
});

// GET /api/auth/students  (ADMIN/LIBRARIAN)
export const getStudents = createHandler(async (req, res) => {
  const page = Math.max(0, parseInt(String(req.query.page ?? "0"), 10) || 0);
  const sizeRaw = parseInt(String(req.query.size ?? "20"), 10) || 20;
  const size = Math.min(sizeRaw, 100);
  const search = req.query.search != null ? String(req.query.search) : null;
  const status = req.query.status != null ? String(req.query.status) : "all";
  const result = await svc.searchStudents(search, status, page, size);
  res.status(200).json(result);
});

// GET /api/auth/by-email  (ADMIN/LIBRARIAN)
export const getByEmail = createHandler(async (req, res) => {
  const email = String(req.query.email ?? "");
  const user = await svc.findByEmailJson(email);
  if (!user) throw AppError.notFound(`User not found with email: ${email}`);
  res.status(200).json(user);
});

// GET /api/auth/by-memberid  (ADMIN/LIBRARIAN)
export const getByMemberId = createHandler(async (req, res) => {
  const memberId = String(req.query.memberId ?? "");
  const user = await svc.findByMemberIdJson(memberId);
  if (!user) throw AppError.notFound(`User not found with memberId: ${memberId}`);
  res.status(200).json(user);
});

// POST /api/auth/students/register  (ADMIN/LIBRARIAN)
export const registerStudent = createHandler(async (req, res) => {
  const body = studentRegisterSchema.parse(req.body);
  const response = await svc.registerStudent(body);
  res.status(201).json(response);
});

// PUT /api/auth/students/:id/activate  (ADMIN/LIBRARIAN)
export const activateStudent = createHandler(async (req, res) => {
  const user = await svc.setActiveStatus(parseId(req.params.id), true);
  res.status(200).json(user);
});

// PUT /api/auth/students/:id/deactivate  (ADMIN/LIBRARIAN)
export const deactivateStudent = createHandler(async (req, res) => {
  const user = await svc.setActiveStatus(parseId(req.params.id), false);
  res.status(200).json(user);
});

// PUT /api/auth/students/:id/reset-password  (ADMIN)
export const resetStudentPassword = createHandler(async (req, res) => {
  const body = passwordResetSchema.parse(req.body ?? {});
  const user = await svc.resetPassword(parseId(req.params.id), body.newPassword ?? null);
  res.status(200).json(user);
});

// PUT /api/auth/students/:id  (ADMIN/LIBRARIAN)
export const updateStudent = createHandler(async (req, res) => {
  const body = studentRegisterSchema.parse(req.body ?? {});
  const user = await svc.updateStudent(parseId(req.params.id), body);
  res.status(200).json(user);
});

// DELETE /api/auth/students/:id  (ADMIN)
export const deleteStudent = createHandler(async (req, res) => {
  await svc.deleteStudent(parseId(req.params.id));
  res.status(204).send();
});

function parseId(raw: string | string[]): number {
  const id = parseInt(String(Array.isArray(raw) ? raw[0] : raw), 10);
  if (Number.isNaN(id)) throw AppError.badRequest("Invalid id");
  return id;
}
