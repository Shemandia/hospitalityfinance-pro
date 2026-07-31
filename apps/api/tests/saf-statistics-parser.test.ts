import { describe, expect, it } from "vitest";
import {
  parseSAFFile,
  isStatisticalAccount
} from "../src/modules/integration/connectors/saf/saf-parser.js";

// ── Sample lines from HFP_Opera_Statistics_Import_v1.1.md §5, reformatted
//    so that pipe-delimited field positions line up with Opera's actual
//    night-audit exports captured at Essque Zalu Zanzibar (2025-08-30).

const EZZDS_Z104_LINE =
  "Z104      |2025008|20250830|||L|000000000000026000|D||FIDST||OCC_R|" +
  "Rooms Occupied           ||||||||||USD||000000000000026000|EZZ |" +
  "     |     |     |     |     |     |     |     |     |";

const EZZDS_Z950_LINE =
  "Z950      |2025008|20250830|||L|000000000007378887|D||FIDST||ROOM_|" +
  "Room Revenue             ||||||||||USD||000000000007378887|EZZ |" +
  "     |     |     |     |     |     |     |     |     |";

const EZZMS_Z132_LINE =
  "Z132      |2025008|20250830|||L|000000000004231500|D||FIDMS||RAC  |" +
  "Rack Rate                ||||||||||USD||000000000004231500|EZZ |" +
  "     |     |     |     |     |     |     |     |     |";

// Opera night-audit files often begin with a whitespace-only first row.
// The parser must skip these without reporting an error.
const EZZDS_FILE = ["       ", EZZDS_Z104_LINE, EZZDS_Z950_LINE].join("\r\n");

const EZZMS_FILE = [EZZMS_Z132_LINE].join("\r\n");

describe("SAF statistics parser", () => {
  it("parses an EZZDS daily statistics line and applies ÷1000 to integer counts", () => {
    const result = parseSAFFile(EZZDS_Z104_LINE, "EZZDS20250830.SUN");
    expect(result.errors).toEqual([]);
    expect(result.lines).toHaveLength(1);

    const line = result.lines[0];
    expect(line.accountCode).toBe("Z104");
    expect(line.accountingPeriod).toBe("2025008");
    expect(line.transactionDate).toBe("20250830");
    expect(line.journalType).toBe("FIDST");
    // 26000 / 1000 = 26 rooms occupied
    expect(line.amount).toBe("26.000");
    expect(line.conversionCode).toBe("USD");
  });

  it("parses an EZZDS revenue stat with 3-decimal fractional amount", () => {
    const result = parseSAFFile(EZZDS_Z950_LINE, "EZZDS20250830.SUN");
    expect(result.errors).toEqual([]);
    const line = result.lines[0];
    expect(line.accountCode).toBe("Z950");
    // 7378887 / 1000 = 7378.887
    expect(line.amount).toBe("7378.887");
    expect(line.journalType).toBe("FIDST");
  });

  it("parses an EZZMS market-segment line (FIDMS journal type)", () => {
    const result = parseSAFFile(EZZMS_Z132_LINE, "EZZMS20250830.SUN");
    expect(result.errors).toEqual([]);
    const line = result.lines[0];
    expect(line.accountCode).toBe("Z132");
    // 4231500 / 1000 = 4231.500
    expect(line.amount).toBe("4231.500");
    expect(line.journalType).toBe("FIDMS");
  });

  it("skips leading blank/whitespace-only lines without errors", () => {
    const result = parseSAFFile(EZZDS_FILE, "EZZDS20250830.SUN");
    expect(result.errors).toEqual([]);
    expect(result.lines).toHaveLength(2);
    expect(result.lines.map((l) => l.accountCode)).toEqual(["Z104", "Z950"]);
  });

  it("classifies EZZDS as daily_stats from the filename prefix", () => {
    const result = parseSAFFile(EZZDS_FILE, "EZZDS20250830.SUN");
    expect(result.operaFileType).toBe("daily_stats");
    expect(result.format).toBe("pipe_delimited");
  });

  it("classifies EZZMS as market_stats from the filename prefix", () => {
    const result = parseSAFFile(EZZMS_FILE, "EZZMS20250830.SUN");
    expect(result.operaFileType).toBe("market_stats");
    expect(result.format).toBe("pipe_delimited");
  });

  it("falls back to the journal type when classifying stats files with no filename", () => {
    const dsResult = parseSAFFile(EZZDS_Z104_LINE);
    expect(dsResult.operaFileType).toBe("daily_stats");

    const msResult = parseSAFFile(EZZMS_Z132_LINE);
    expect(msResult.operaFileType).toBe("market_stats");
  });

  it("isStatisticalAccount identifies Z-prefix codes", () => {
    expect(isStatisticalAccount("Z104")).toBe(true);
    expect(isStatisticalAccount("Z950")).toBe(true);
    expect(isStatisticalAccount("Z132")).toBe(true);
    // Non-Z codes are not statistics
    expect(isStatisticalAccount("40000")).toBe(false);
    expect(isStatisticalAccount("CVENDOR")).toBe(false);
  });

  it("statistics files do not need to pass debit/credit balance (single-sided memo postings)", () => {
    // Every stats line has dcMarker=D and no counter-entry, so totalDebits != totalCredits.
    // parseSAFFile still computes the totals but the import service is responsible for
    // skipping the balance check — verify the parser at least reports the imbalance
    // rather than silently hiding it.
    const result = parseSAFFile(EZZDS_FILE, "EZZDS20250830.SUN");
    expect(result.isBalanced).toBe(false);
    expect(result.operaFileType).toBe("daily_stats");
  });
});
