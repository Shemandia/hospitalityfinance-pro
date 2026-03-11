const ones = [
  "",
  "ONE",
  "TWO",
  "THREE",
  "FOUR",
  "FIVE",
  "SIX",
  "SEVEN",
  "EIGHT",
  "NINE",
  "TEN",
  "ELEVEN",
  "TWELVE",
  "THIRTEEN",
  "FOURTEEN",
  "FIFTEEN",
  "SIXTEEN",
  "SEVENTEEN",
  "EIGHTEEN",
  "NINETEEN"
];

const tens = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];

const scales = ["", "THOUSAND", "MILLION", "BILLION"];

function convertGroup(n: number): string {
  if (n === 0) return "";

  const hundred = Math.floor(n / 100);
  const remainder = n % 100;

  const parts: string[] = [];

  if (hundred > 0) {
    parts.push(`${ones[hundred]} HUNDRED`);
  }

  if (remainder > 0) {
    if (hundred > 0) parts.push("AND");
    if (remainder < 20) {
      parts.push(ones[remainder]);
    } else {
      const t = Math.floor(remainder / 10);
      const o = remainder % 10;
      parts.push(o > 0 ? `${tens[t]} ${ones[o]}` : tens[t]);
    }
  }

  return parts.join(" ");
}

function convertInteger(n: number): string {
  if (n === 0) return "ZERO";

  const groups: number[] = [];
  let remaining = Math.floor(n);

  while (remaining > 0) {
    groups.push(remaining % 1000);
    remaining = Math.floor(remaining / 1000);
  }

  const parts: string[] = [];

  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue;
    const groupText = convertGroup(groups[i]);
    parts.push(scales[i] ? `${groupText} ${scales[i]}` : groupText);
  }

  return parts.join(" ");
}

/**
 * Converts a numeric amount to English words for cheque/voucher printing.
 *
 * @example
 * amountToWords(402500, "TZS")
 * // => "FOUR HUNDRED AND TWO THOUSAND FIVE HUNDRED TZS AND ZERO"
 *
 * amountToWords(1234.56, "USD")
 * // => "ONE THOUSAND TWO HUNDRED AND THIRTY FOUR USD AND FIFTY SIX"
 */
export function amountToWords(amount: number, currencyCode: string): string {
  const abs = Math.abs(amount);
  const integerPart = Math.floor(abs);
  const fractionalPart = Math.round((abs - integerPart) * 100);

  const integerWords = convertInteger(integerPart);
  const fractionalWords = fractionalPart === 0 ? "ZERO" : convertInteger(fractionalPart);

  return `${integerWords} ${currencyCode} AND ${fractionalWords}`;
}
