/**
 * @hfp/tml-engine — Pre-built function library
 *
 * These functions are injected into every sandbox as built-in helpers.
 * They are defined as a single JavaScript source string so they can be
 * evaluated inside the V8 isolate / vm context.
 */

/**
 * JavaScript source code for all pre-built functions.
 * Each function is a plain ES5-compatible function declaration.
 */
export const BUILTIN_FUNCTIONS_SOURCE = `
/**
 * formatDate — convert a date string from one format to another.
 * Supported tokens: YYYY, MM, DD, yyyy, mm, dd.
 * Input must be parseable by Date or match the fromFormat pattern.
 */
function formatDate(value, fromFormat, toFormat) {
  if (!value) return "";
  var y, m, d;

  // Try parsing from the fromFormat pattern
  if (fromFormat === "YYYY-MM-DD" || fromFormat === "yyyy-mm-dd") {
    var parts = String(value).split("-");
    y = parts[0]; m = parts[1]; d = parts[2];
  } else if (fromFormat === "DD/MM/YYYY" || fromFormat === "dd/mm/yyyy") {
    var parts = String(value).split("/");
    d = parts[0]; m = parts[1]; y = parts[2];
  } else if (fromFormat === "MM/DD/YYYY" || fromFormat === "mm/dd/yyyy") {
    var parts = String(value).split("/");
    m = parts[0]; d = parts[1]; y = parts[2];
  } else if (fromFormat === "YYYYMMDD" || fromFormat === "yyyymmdd") {
    var s = String(value);
    y = s.substring(0, 4); m = s.substring(4, 6); d = s.substring(6, 8);
  } else {
    // Fallback: try Date parse
    var dt = new Date(String(value));
    if (isNaN(dt.getTime())) return String(value);
    y = String(dt.getFullYear());
    m = String(dt.getMonth() + 1).padStart(2, "0");
    d = String(dt.getDate()).padStart(2, "0");
  }

  if (!y || !m || !d) return String(value);
  y = y.padStart(4, "0");
  m = m.padStart(2, "0");
  d = d.padStart(2, "0");

  var out = toFormat;
  out = out.replace(/YYYY|yyyy/g, y);
  out = out.replace(/MM|mm/g, m);
  out = out.replace(/DD|dd/g, d);
  return out;
}

/**
 * padLeft — pad a string on the left with a fill character to a given length.
 */
function padLeft(value, length, fillChar) {
  var s = String(value != null ? value : "");
  var ch = fillChar != null ? String(fillChar) : " ";
  while (s.length < length) s = ch + s;
  return s;
}

/**
 * padRight — pad a string on the right with a fill character to a given length.
 */
function padRight(value, length, fillChar) {
  var s = String(value != null ? value : "");
  var ch = fillChar != null ? String(fillChar) : " ";
  while (s.length < length) s = s + ch;
  return s;
}

/**
 * toUpperCase — convert a string to upper case.
 */
function toUpperCase(value) {
  return String(value != null ? value : "").toUpperCase();
}

/**
 * toLowerCase — convert a string to lower case.
 */
function toLowerCase(value) {
  return String(value != null ? value : "").toLowerCase();
}

/**
 * currencyConvert — multiply an amount by an exchange rate.
 */
function currencyConvert(amount, rate) {
  var a = Number(amount);
  var r = Number(rate);
  if (isNaN(a) || isNaN(r)) return 0;
  return Math.round(a * r * 100) / 100;
}

/**
 * divideBy1000 — divide a numeric value by 1000.
 * Used for Jana internal movement implied-decimal rule.
 */
function divideBy1000(value) {
  var n = Number(value);
  if (isNaN(n)) return 0;
  return n / 1000;
}

/**
 * multiplyBy1000 — multiply a numeric value by 1000.
 * Reverse of divideBy1000 for export back to Jana format.
 */
function multiplyBy1000(value) {
  var n = Number(value);
  if (isNaN(n)) return 0;
  return n * 1000;
}
`.trim();

/**
 * Metadata for the pre-built function library.
 * Useful for UI display and API documentation.
 */
export const BUILTIN_FUNCTIONS_META = [
  {
    name: "formatDate",
    description: "Convert a date string from one format to another",
    params: [
      { name: "value", type: "string" as const },
      { name: "fromFormat", type: "string" as const },
      { name: "toFormat", type: "string" as const }
    ]
  },
  {
    name: "padLeft",
    description: "Pad a string on the left to a given length",
    params: [
      { name: "value", type: "string" as const },
      { name: "length", type: "number" as const },
      { name: "fillChar", type: "string" as const }
    ]
  },
  {
    name: "padRight",
    description: "Pad a string on the right to a given length",
    params: [
      { name: "value", type: "string" as const },
      { name: "length", type: "number" as const },
      { name: "fillChar", type: "string" as const }
    ]
  },
  {
    name: "toUpperCase",
    description: "Convert a string to upper case",
    params: [{ name: "value", type: "string" as const }]
  },
  {
    name: "toLowerCase",
    description: "Convert a string to lower case",
    params: [{ name: "value", type: "string" as const }]
  },
  {
    name: "currencyConvert",
    description: "Multiply an amount by an exchange rate (2dp rounding)",
    params: [
      { name: "amount", type: "number" as const },
      { name: "rate", type: "number" as const }
    ]
  },
  {
    name: "divideBy1000",
    description: "Divide a numeric value by 1000 (Jana implied-decimal rule)",
    params: [{ name: "value", type: "number" as const }]
  },
  {
    name: "multiplyBy1000",
    description: "Multiply a numeric value by 1000 (reverse Jana rule for export)",
    params: [{ name: "value", type: "number" as const }]
  }
] as const;
