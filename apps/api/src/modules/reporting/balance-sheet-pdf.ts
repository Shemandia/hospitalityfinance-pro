import { Document, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import React from "react";

// ─── Data Types ──────────────────────────────────────────────────────────────

export type BalanceSheetPdfData = {
  entityName: string;
  asOf: string;
  assets: Array<{
    name: string;
    accounts: Array<{ code: string; name: string; balance: string }>;
    total: string;
  }>;
  liabilities: Array<{
    name: string;
    accounts: Array<{ code: string; name: string; balance: string }>;
    total: string;
  }>;
  equity: Array<{
    name: string;
    accounts: Array<{ code: string; name: string; balance: string }>;
    total: string;
  }>;
  totalAssets: string;
  totalLiabilities: string;
  totalEquity: string;
  totalLiabilitiesAndEquity: string;
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const NAVY = "#1a3b6e";
const SHADE = "#f8fafc";

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 9,
    fontFamily: "Helvetica"
  },

  // Header
  entityName: {
    fontSize: 12,
    fontWeight: "bold",
    color: NAVY,
    textAlign: "center",
    marginBottom: 4
  },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    color: NAVY,
    textAlign: "center",
    marginBottom: 4
  },
  subtitle: {
    fontSize: 10,
    textAlign: "center",
    color: "#555",
    marginBottom: 16
  },

  // Category heading (ASSETS / LIABILITIES / EQUITY)
  categoryHeading: {
    fontSize: 12,
    fontWeight: "bold",
    color: NAVY,
    marginTop: 14,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: NAVY,
    paddingBottom: 3
  },

  // Section header (sub-category)
  sectionHeader: {
    flexDirection: "row",
    backgroundColor: NAVY,
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginTop: 6,
    marginBottom: 2
  },
  sectionHeaderText: {
    fontSize: 9,
    fontWeight: "bold",
    color: "#ffffff"
  },

  // Account row
  accountRow: {
    flexDirection: "row",
    paddingVertical: 3,
    paddingHorizontal: 6
  },
  accountRowShaded: {
    flexDirection: "row",
    paddingVertical: 3,
    paddingHorizontal: 6,
    backgroundColor: SHADE
  },
  colCode: {
    width: "10%",
    fontSize: 8
  },
  colName: {
    width: "60%",
    fontSize: 8
  },
  colBalance: {
    width: "30%",
    fontSize: 8,
    textAlign: "right"
  },

  // Section total row
  sectionTotalRow: {
    flexDirection: "row",
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderTopWidth: 1,
    borderTopColor: "#333",
    marginTop: 2,
    marginBottom: 4
  },
  sectionTotalLabel: {
    width: "70%",
    fontSize: 9,
    fontWeight: "bold"
  },
  sectionTotalValue: {
    width: "30%",
    fontSize: 9,
    fontWeight: "bold",
    textAlign: "right"
  },

  // Grand total row
  grandTotalRow: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderTopWidth: 2,
    borderTopColor: NAVY,
    marginTop: 4,
    marginBottom: 8
  },
  grandTotalLabel: {
    width: "70%",
    fontSize: 10,
    fontWeight: "bold",
    color: NAVY
  },
  grandTotalValue: {
    width: "30%",
    fontSize: 10,
    fontWeight: "bold",
    color: NAVY,
    textAlign: "right"
  },

  // Footer
  footer: {
    position: "absolute",
    bottom: 24,
    left: 36,
    right: 36,
    fontSize: 7,
    color: "#999",
    textAlign: "center"
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildSectionGroup(
  sections: Array<{
    name: string;
    accounts: Array<{ code: string; name: string; balance: string }>;
    total: string;
  }>,
  keyPrefix: string
) {
  const el = React.createElement;
  const elements: React.ReactElement[] = [];

  for (let s = 0; s < sections.length; s++) {
    const section = sections[s];

    // Section header
    elements.push(
      el(
        View,
        { key: `${keyPrefix}-sh-${s}`, style: styles.sectionHeader },
        el(Text, { style: styles.sectionHeaderText }, section.name.toUpperCase())
      )
    );

    // Account rows
    for (let a = 0; a < section.accounts.length; a++) {
      const acct = section.accounts[a];
      const rowStyle = a % 2 === 1 ? styles.accountRowShaded : styles.accountRow;
      elements.push(
        el(
          View,
          { key: `${keyPrefix}-ar-${s}-${a}`, style: rowStyle },
          el(Text, { style: styles.colCode }, acct.code),
          el(Text, { style: styles.colName }, acct.name),
          el(Text, { style: styles.colBalance }, acct.balance)
        )
      );
    }

    // Section total
    elements.push(
      el(
        View,
        { key: `${keyPrefix}-st-${s}`, style: styles.sectionTotalRow },
        el(Text, { style: styles.sectionTotalLabel }, `Total ${section.name}`),
        el(Text, { style: styles.sectionTotalValue }, section.total)
      )
    );
  }

  return elements;
}

// ─── Document Builder ────────────────────────────────────────────────────────

function buildBalanceSheetDocument(data: BalanceSheetPdfData) {
  const el = React.createElement;
  const generatedDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });

  return el(
    Document,
    null,
    el(
      Page,
      { size: "A4", style: styles.page },

      // ── Header
      el(Text, { style: styles.entityName }, data.entityName.toUpperCase()),
      el(Text, { style: styles.title }, "BALANCE SHEET"),
      el(Text, { style: styles.subtitle }, `As of ${data.asOf}`),

      // ── ASSETS
      el(Text, { style: styles.categoryHeading }, "ASSETS"),
      ...buildSectionGroup(data.assets, "asset"),
      el(
        View,
        { style: styles.grandTotalRow },
        el(Text, { style: styles.grandTotalLabel }, "TOTAL ASSETS"),
        el(Text, { style: styles.grandTotalValue }, data.totalAssets)
      ),

      // ── LIABILITIES
      el(Text, { style: styles.categoryHeading }, "LIABILITIES"),
      ...buildSectionGroup(data.liabilities, "liab"),
      el(
        View,
        { style: styles.grandTotalRow },
        el(Text, { style: styles.grandTotalLabel }, "TOTAL LIABILITIES"),
        el(Text, { style: styles.grandTotalValue }, data.totalLiabilities)
      ),

      // ── EQUITY
      el(Text, { style: styles.categoryHeading }, "EQUITY"),
      ...buildSectionGroup(data.equity, "eq"),
      el(
        View,
        { style: styles.grandTotalRow },
        el(Text, { style: styles.grandTotalLabel }, "TOTAL EQUITY"),
        el(Text, { style: styles.grandTotalValue }, data.totalEquity)
      ),

      // ── Final total: TOTAL LIABILITIES & EQUITY
      el(
        View,
        { style: { ...styles.grandTotalRow, borderTopWidth: 3, marginTop: 8 } },
        el(
          Text,
          { style: { ...styles.grandTotalLabel, fontSize: 11 } },
          "TOTAL LIABILITIES & EQUITY"
        ),
        el(
          Text,
          { style: { ...styles.grandTotalValue, fontSize: 11 } },
          data.totalLiabilitiesAndEquity
        )
      ),

      // ── Footer
      el(Text, { style: styles.footer }, `Generated on ${generatedDate}`)
    )
  );
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function renderBalanceSheetPdf(data: BalanceSheetPdfData): Promise<Buffer> {
  const document = buildBalanceSheetDocument(data);
  return renderToBuffer(document);
}
