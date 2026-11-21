/**
 * Exact decimal arithmetic on strings, for money and quantities. Amounts in a
 * document are decimal strings (never floating point); sums and comparisons
 * are done on integers scaled to a fixed number of places.
 */

const DECIMAL = /^[+-]?(\d+)(?:\.(\d+))?$/;

/** True for a plain decimal string ("12", "-0.5", "1234.5678"). */
export function isDecimal(value: string): boolean {
  return DECIMAL.test(value);
}

/** Digits after the decimal point. */
export function scaleOf(value: string): number {
  const m = DECIMAL.exec(value);
  return m?.[2]?.length ?? 0;
}

/** The value as an integer of `scale` places; throws when it has more places. */
export function toScaled(value: string, scale: number): bigint {
  const m = DECIMAL.exec(value);
  if (!m) throw new Error(`Not a decimal: ${value}`);
  const fraction = m[2] ?? "";
  if (fraction.length > scale) throw new Error(`${value} has more than ${scale} decimal places`);
  const digits = BigInt(m[1]! + fraction.padEnd(scale, "0"));
  return value.startsWith("-") ? -digits : digits;
}

/** An integer of `scale` places as a decimal string ("1234500", 4 -> "123.45"). */
export function fromScaled(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = scale > 0 ? digits.slice(-scale).replace(/0+$/, "") : "";
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}
