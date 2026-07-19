/**
 * Pricing helpers shared across registration, subscriptions and fee billing so
 * a percentage discount is applied identically everywhere (and stays in sync
 * with the monthly invoice generator).
 */

/** Clamp an arbitrary discount input to a valid 0-100 percentage. */
export function normalizeDiscountPercent(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n >= 100) return 100;
  return Math.round(n * 100) / 100;
}

/** Apply a percentage discount to a price, rounded to 2 decimals (never below 0). */
export function applyDiscount(price: number | string, discountPercent: unknown): number {
  const base = Number(price) || 0;
  const pct = normalizeDiscountPercent(discountPercent);
  const net = base * (1 - pct / 100);
  return Math.max(0, Math.round(net * 100) / 100);
}
