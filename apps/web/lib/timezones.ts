/** Full IANA timezone list with a guarded fallback for older runtimes. */
export function getSupportedTimezones(): string[] {
  const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: "timeZone") => string[];
  };
  if (typeof intl.supportedValuesOf === "function") {
    try {
      const zones = intl.supportedValuesOf("timeZone");
      // V8 leaves UTC out of the list, but forms start on it.
      if (Array.isArray(zones) && zones.length > 0) {
        return zones.includes("UTC") ? zones : ["UTC", ...zones];
      }
    } catch {
      // fall through to fallback
    }
  }
  return [
    "UTC",
    "Africa/Dar_es_Salaam",
    "Africa/Nairobi",
    "Africa/Johannesburg",
    "Asia/Dubai",
    "Asia/Singapore",
    "Asia/Tokyo",
    "Europe/London",
    "Europe/Paris",
    "America/New_York",
    "America/Chicago",
    "America/Los_Angeles",
    "Australia/Sydney",
    "Pacific/Auckland"
  ];
}

export const FALLBACK_TIMEZONES = getSupportedTimezones();
