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

/**
 * trim — remove leading and trailing whitespace.
 */
function trim(value) {
  return String(value != null ? value : "").trim();
}

/**
 * numberFormat — format a number with decimal places and separators.
 * @param value     - numeric value
 * @param decimals  - number of decimal places
 * @param thousandsSep - thousands separator (default ",")
 * @param decimalSep   - decimal separator (default ".")
 */
function numberFormat(value, decimals, thousandsSep, decimalSep) {
  var n = Number(value);
  if (isNaN(n)) return String(value != null ? value : "");
  var d = decimals != null ? Number(decimals) : 2;
  var ts = thousandsSep != null ? String(thousandsSep) : ",";
  var ds = decimalSep != null ? String(decimalSep) : ".";
  var fixed = n.toFixed(d);
  var parts = fixed.split(".");
  var intPart = parts[0];
  var fracPart = parts[1] || "";
  // Add thousands separator
  var negative = intPart.charAt(0) === "-";
  if (negative) intPart = intPart.substring(1);
  var result = "";
  for (var i = intPart.length - 1, count = 0; i >= 0; i--, count++) {
    if (count > 0 && count % 3 === 0) result = ts + result;
    result = intPart.charAt(i) + result;
  }
  if (negative) result = "-" + result;
  if (d > 0) result = result + ds + fracPart;
  return result;
}

/**
 * substring — extract a substring from a value.
 * @param value  - input string
 * @param start  - start position (0-based)
 * @param length - number of characters
 */
function substring(value, start, length) {
  var s = String(value != null ? value : "");
  var st = Number(start) || 0;
  var ln = Number(length);
  if (isNaN(ln)) return s.substring(st);
  return s.substring(st, st + ln);
}

/**
 * replace — find and replace in a string.
 * @param value   - input string
 * @param find    - search string or regex pattern
 * @param repl    - replacement string
 * @param isRegex - treat find as regex (truthy = yes)
 */
function replace(value, find, repl, isRegex) {
  var s = String(value != null ? value : "");
  var r = repl != null ? String(repl) : "";
  if (isRegex) {
    return s.replace(new RegExp(String(find), "g"), r);
  }
  // Global string replace
  var result = s;
  var f = String(find);
  while (result.indexOf(f) !== -1) {
    result = result.replace(f, r);
  }
  return result;
}

/**
 * lookupValue — look up a value in a mapping object (JSON string).
 * @param value        - the value to look up
 * @param mappingsJson - JSON string of { key: value } mappings
 * @param defaultVal   - fallback if not found
 */
function lookupValue(value, mappingsJson, defaultVal) {
  var s = String(value != null ? value : "");
  try {
    var map = JSON.parse(String(mappingsJson));
    if (map.hasOwnProperty(s)) return String(map[s]);
  } catch(e) {}
  return defaultVal != null ? String(defaultVal) : s;
}

/**
 * divide — divide a value by a divisor.
 */
function divide(value, divisor) {
  var n = Number(value);
  var d = Number(divisor);
  if (isNaN(n) || isNaN(d) || d === 0) return 0;
  return Math.round(n / d * 100) / 100;
}

/**
 * multiply — multiply a value by a multiplier.
 */
function multiply(value, multiplier) {
  var n = Number(value);
  var m = Number(multiplier);
  if (isNaN(n) || isNaN(m)) return 0;
  return Math.round(n * m * 100) / 100;
}

/**
 * defaultValue — return the value, or fallback if empty/null/undefined.
 */
function defaultValue(value, fallback) {
  if (value == null || String(value).trim() === "") {
    return fallback != null ? fallback : "";
  }
  return value;
}

/**
 * concatFields — concatenate multiple values with a separator.
 * Values are passed as individual arguments; last argument is the separator.
 * Convention: concatFields(val1, val2, ..., valN, separator)
 */
function concatFields() {
  var args = Array.prototype.slice.call(arguments);
  if (args.length === 0) return "";
  var sep = args.length > 1 ? String(args[args.length - 1]) : "";
  var values = args.slice(0, args.length > 1 ? args.length - 1 : 1);
  var parts = [];
  for (var i = 0; i < values.length; i++) {
    parts.push(values[i] != null ? String(values[i]) : "");
  }
  return parts.join(sep);
}

/**
 * splitField — split a string by delimiter and return the Nth part.
 * @param value     - input string
 * @param delimiter - split delimiter
 * @param index     - 0-based part index
 */
function splitField(value, delimiter, index) {
  var s = String(value != null ? value : "");
  var d = delimiter != null ? String(delimiter) : ",";
  var parts = s.split(d);
  var idx = Number(index) || 0;
  return idx >= 0 && idx < parts.length ? parts[idx] : "";
}

/**
 * currencyCode — map a currency abbreviation to its ISO code.
 * @param value        - currency abbreviation
 * @param mappingsJson - JSON string of { abbreviation: isoCode }
 */
function currencyCode(value, mappingsJson) {
  var s = String(value != null ? value : "").trim().toUpperCase();
  try {
    var map = JSON.parse(String(mappingsJson));
    if (map.hasOwnProperty(s)) return String(map[s]);
  } catch(e) {}
  return s;
}

/**
 * accountSegment — extract a segment from a composite account code.
 * @param value        - composite account code (e.g. "4100-001-003")
 * @param delimiter    - segment delimiter (e.g. "-")
 * @param segmentIndex - 0-based segment index
 */
function accountSegment(value, delimiter, segmentIndex) {
  var s = String(value != null ? value : "");
  var d = delimiter != null ? String(delimiter) : "-";
  var parts = s.split(d);
  var idx = Number(segmentIndex) || 0;
  return idx >= 0 && idx < parts.length ? parts[idx].trim() : "";
}

/**
 * operaDate — parse Opera PMS date formats (YYYYMMDD or YYMMDD)
 * and return ISO date string YYYY-MM-DD.
 * @param value  - date string from Opera
 * @param format - "YYYYMMDD" or "YYMMDD"
 */
function operaDate(value, format) {
  var s = String(value != null ? value : "").trim();
  if (!s) return "";
  var y, m, d;
  if (format === "YYMMDD" && s.length >= 6) {
    y = "20" + s.substring(0, 2);
    m = s.substring(2, 4);
    d = s.substring(4, 6);
  } else if (s.length >= 8) {
    y = s.substring(0, 4);
    m = s.substring(4, 6);
    d = s.substring(6, 8);
  } else {
    return s;
  }
  return y + "-" + m + "-" + d;
}

/**
 * janaAmount — apply divide-by-1000 for Jana internal movement files.
 * This is an explicit user-selected convenience function, NEVER auto-applied.
 */
function janaAmount(value) {
  var n = Number(value);
  if (isNaN(n)) return 0;
  return n / 1000;
}

/**
 * simphonyRvc — map a Simphony Revenue Centre code to a department.
 * @param value        - RVC code
 * @param mappingsJson - JSON string of { rvcCode: departmentName }
 */
function simphonyRvc(value, mappingsJson) {
  var s = String(value != null ? value : "").trim();
  try {
    var map = JSON.parse(String(mappingsJson));
    if (map.hasOwnProperty(s)) return String(map[s]);
  } catch(e) {}
  return s;
}

/**
 * usaliMap — map an account code to its USALI department code.
 * Uses a simplified built-in lookup for common USALI 12th edition departments.
 * @param value        - account code
 * @param usaliVersion - USALI version (e.g. "12th")
 */
function usaliMap(value, usaliVersion) {
  var s = String(value != null ? value : "").trim();
  // Simplified USALI 12th edition: first 2 digits map to department
  var prefix = s.substring(0, 2);
  var departments = {
    "41": "Rooms",
    "42": "Food",
    "43": "Beverage",
    "44": "Telecommunications",
    "45": "Garage & Parking",
    "46": "Golf Course",
    "47": "Guest Laundry",
    "48": "Health Club/Spa",
    "49": "Swimming Pool",
    "50": "Tennis",
    "51": "Other Operated Departments",
    "60": "Administrative & General",
    "61": "Info & Telecom Systems",
    "62": "Sales & Marketing",
    "63": "Property Operations",
    "64": "Utilities",
    "70": "Management Fees",
    "75": "Rent & Other Income",
    "80": "Interest Expense",
    "85": "Depreciation & Amortization"
  };
  if (departments.hasOwnProperty(prefix)) return departments[prefix];
  return s;
}

/**
 * entityCode — map a property code to an HFP entity ID.
 * Uses a JSON mapping string. Pass empty mappings to return value as-is.
 * @param value        - property code
 * @param mappingsJson - JSON string of { propertyCode: entityId } (optional)
 */
function entityCode(value, mappingsJson) {
  var s = String(value != null ? value : "").trim();
  if (mappingsJson) {
    try {
      var map = JSON.parse(String(mappingsJson));
      if (map.hasOwnProperty(s)) return String(map[s]);
    } catch(e) {}
  }
  return s;
}

/**
 * taxExtract — split a gross amount into net + tax.
 * Returns the net amount by default. To get tax amount, pass "tax" as returnPart.
 * @param value        - gross amount
 * @param taxRate      - tax rate (e.g. 0.15 for 15%)
 * @param taxInclusive - whether the amount is tax-inclusive (truthy = yes)
 * @param returnPart   - "net" (default) or "tax"
 */
function taxExtract(value, taxRate, taxInclusive, returnPart) {
  var amount = Number(value);
  var rate = Number(taxRate);
  if (isNaN(amount) || isNaN(rate)) return 0;
  var net, tax;
  if (taxInclusive) {
    net = Math.round(amount / (1 + rate) * 100) / 100;
    tax = Math.round((amount - net) * 100) / 100;
  } else {
    net = amount;
    tax = Math.round(amount * rate * 100) / 100;
  }
  var part = String(returnPart || "net").toLowerCase();
  return part === "tax" ? tax : net;
}
`.trim();

/**
 * Metadata for the pre-built function library.
 * Useful for UI display and API documentation.
 */
export const BUILTIN_FUNCTIONS_META = [
  // ── Original functions ──
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
  },
  // ── Core functions (new) ──
  {
    name: "trim",
    description: "Trim leading and trailing whitespace",
    params: [{ name: "value", type: "string" as const }]
  },
  {
    name: "numberFormat",
    description: "Format a number with decimal places and separators",
    params: [
      { name: "value", type: "number" as const },
      { name: "decimals", type: "number" as const },
      { name: "thousandsSep", type: "string" as const },
      { name: "decimalSep", type: "string" as const }
    ]
  },
  {
    name: "substring",
    description: "Extract a substring from a value",
    params: [
      { name: "value", type: "string" as const },
      { name: "start", type: "number" as const },
      { name: "length", type: "number" as const }
    ]
  },
  {
    name: "replace",
    description: "Find and replace in a string",
    params: [
      { name: "value", type: "string" as const },
      { name: "find", type: "string" as const },
      { name: "replace", type: "string" as const },
      { name: "isRegex", type: "number" as const }
    ]
  },
  {
    name: "lookupValue",
    description: "Look up a value in a JSON mapping object",
    params: [
      { name: "value", type: "string" as const },
      { name: "mappingsJson", type: "string" as const },
      { name: "defaultVal", type: "string" as const }
    ]
  },
  {
    name: "divide",
    description: "Divide a value by a divisor (2dp rounding)",
    params: [
      { name: "value", type: "number" as const },
      { name: "divisor", type: "number" as const }
    ]
  },
  {
    name: "multiply",
    description: "Multiply a value by a multiplier (2dp rounding)",
    params: [
      { name: "value", type: "number" as const },
      { name: "multiplier", type: "number" as const }
    ]
  },
  {
    name: "defaultValue",
    description: "Return fallback if value is empty or null",
    params: [
      { name: "value", type: "string" as const },
      { name: "fallback", type: "string" as const }
    ]
  },
  {
    name: "concatFields",
    description: "Concatenate values with a separator (last arg is separator)",
    params: [
      { name: "values", type: "string" as const },
      { name: "separator", type: "string" as const }
    ]
  },
  {
    name: "splitField",
    description: "Split a string by delimiter and return the Nth part",
    params: [
      { name: "value", type: "string" as const },
      { name: "delimiter", type: "string" as const },
      { name: "index", type: "number" as const }
    ]
  },
  {
    name: "currencyCode",
    description: "Map a currency abbreviation to its ISO code via JSON mapping",
    params: [
      { name: "value", type: "string" as const },
      { name: "mappingsJson", type: "string" as const }
    ]
  },
  {
    name: "accountSegment",
    description: "Extract a segment from a composite account code",
    params: [
      { name: "value", type: "string" as const },
      { name: "delimiter", type: "string" as const },
      { name: "segmentIndex", type: "number" as const }
    ]
  },
  // ── Hospitality functions (new) ──
  {
    name: "operaDate",
    description: "Parse Opera PMS date formats (YYYYMMDD, YYMMDD) to ISO",
    params: [
      { name: "value", type: "string" as const },
      { name: "format", type: "string" as const }
    ]
  },
  {
    name: "janaAmount",
    description:
      "Apply ÷1000 divisor for Jana internal movement files (user-selected, never auto-applied)",
    params: [{ name: "value", type: "number" as const }]
  },
  {
    name: "simphonyRvc",
    description: "Map Simphony RVC code to department via JSON mapping",
    params: [
      { name: "value", type: "string" as const },
      { name: "mappingsJson", type: "string" as const }
    ]
  },
  {
    name: "usaliMap",
    description: "Map account code to USALI department (12th edition built-in lookup)",
    params: [
      { name: "value", type: "string" as const },
      { name: "usaliVersion", type: "string" as const }
    ]
  },
  {
    name: "entityCode",
    description: "Map property code to HFP entity ID via JSON mapping",
    params: [
      { name: "value", type: "string" as const },
      { name: "mappingsJson", type: "string" as const }
    ]
  },
  {
    name: "taxExtract",
    description: "Split gross amount into net + tax (returns net by default, pass 'tax' for tax)",
    params: [
      { name: "value", type: "number" as const },
      { name: "taxRate", type: "number" as const },
      { name: "taxInclusive", type: "number" as const },
      { name: "returnPart", type: "string" as const }
    ]
  }
] as const;
