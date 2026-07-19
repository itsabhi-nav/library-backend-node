/** Parse HH:MM or HH:MM:SS into minutes from midnight. */
export function parseTimeToMinutes(raw: string): number {
  const parts = String(raw).substring(0, 8).split(":");
  const h = parseInt(parts[0] ?? "0", 10);
  const m = parseInt(parts[1] ?? "0", 10);
  return h * 60 + m;
}

/** Format a stored shift clock ("07:00" / "07:00:00") as "7:00 AM". */
export function formatShiftTime12h(raw: string): string {
  const parts = String(raw).substring(0, 8).split(":");
  const h = parseInt(parts[0] ?? "0", 10);
  const m = parseInt(parts[1] ?? "0", 10);
  const ampm = h >= 12 ? "PM" : "AM";
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

export type ShiftTimes = { startTime: string; endTime: string };

/** True when two shift windows overlap (touching endpoints do not overlap). */
export function shiftsOverlap(a: ShiftTimes, b: ShiftTimes): boolean {
  const aStart = parseTimeToMinutes(a.startTime);
  const aEnd = parseTimeToMinutes(a.endTime);
  const bStart = parseTimeToMinutes(b.startTime);
  const bEnd = parseTimeToMinutes(b.endTime);
  return aStart < bEnd && bStart < aEnd;
}

/** Plans without a shift block every shift on the assigned seat. */
export function shiftBlocksSeat(
  occupantShift: ShiftTimes | null,
  targetShift: ShiftTimes
): boolean {
  if (!occupantShift) return true;
  return shiftsOverlap(occupantShift, targetShift);
}
