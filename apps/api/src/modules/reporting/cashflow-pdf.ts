import { Document, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import React from "react";

// ─── Data Types ──────────────────────────────────────────────────────────────

export type CashFlowPdfData = {
  entityName: string;
  periodName: string;
  operating: {
    label: string;
    items: Array<{ description: string; amount: string }>;
    total: string;
  };
  investing: {
    label: string;
    items: Array<{ description: string; amount: string }>;
    total: string;
  };
  financing: {
    label: string;
    items: Array<{ description: string; amount: string }>;
    total: string;
  };
  netChange: string;
  openingCash: string;
  closingCash: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const NAVY = "#1a3b6e";

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
    fontSize: 16,
    fontWeight: "bold",
    color: NAVY,
    textAlign: "center",
    marginBottom: 4
  },
  periodName: {
    fontSize: 10,
    textAlign: "center",
    color: "#555",
    marginBottom: 20
  },

  // Section header
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: NAVY,
    paddingVertical: 5,
    paddingHorizontal: 8,
    marginTop: 10
  },
  sectionHeaderText: {
    fontSize: 10,
    fontWeight: "bold",
    color: "#ffffff"
  },

  // Item row
  itemRow: {
    flexDirection: "row",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e0e0e0"
  },
  itemDescription: {
    width: "70%",
    fontSize: 9
  },
  itemAmount: {
    width: "30%",
    fontSize: 9,
    textAlign: "right"
  },

  // Total row
  totalRow: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderTopColor: "#333"
  },
  totalLabel: {
    width: "70%",
    fontSize: 9,
    fontWeight: "bold"
  },
  totalAmount: {
    width: "30%",
    fontSize: 9,
    fontWeight: "bold",
    textAlign: "right"
  },

  // Separator
  separator: {
    borderBottomWidth: 1,
    borderBottomColor: "#333",
    marginTop: 16,
    marginBottom: 12
  },

  // Summary rows
  summaryRow: {
    flexDirection: "row",
    paddingVertical: 4,
    paddingHorizontal: 8
  },
  summaryLabel: {
    width: "70%",
    fontSize: 9
  },
  summaryLabelBold: {
    width: "70%",
    fontSize: 9,
    fontWeight: "bold"
  },
  summaryAmount: {
    width: "30%",
    fontSize: 9,
    textAlign: "right"
  },
  summaryAmountBold: {
    width: "30%",
    fontSize: 9,
    fontWeight: "bold",
    textAlign: "right"
  },

  // Closing cash row (navy background)
  closingRow: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: NAVY,
    marginTop: 4
  },
  closingLabel: {
    width: "70%",
    fontSize: 10,
    fontWeight: "bold",
    color: "#ffffff"
  },
  closingAmount: {
    width: "30%",
    fontSize: 10,
    fontWeight: "bold",
    color: "#ffffff",
    textAlign: "right"
  },

  // Footer
  footer: {
    marginTop: 30,
    fontSize: 7,
    color: "#999",
    textAlign: "center"
  }
});

// ─── Section Builder ─────────────────────────────────────────────────────────

type CashFlowSection = CashFlowPdfData["operating"];

function buildSection(
  el: typeof React.createElement,
  section: CashFlowSection,
  sectionName: string
) {
  return [
    // Section header
    el(
      View,
      { key: `hdr-${sectionName}`, style: styles.sectionHeader },
      el(Text, { style: styles.sectionHeaderText }, section.label)
    ),

    // Item rows
    ...section.items.map((item, idx) =>
      el(
        View,
        { key: `item-${sectionName}-${idx}`, style: styles.itemRow },
        el(Text, { style: styles.itemDescription }, item.description),
        el(Text, { style: styles.itemAmount }, item.amount)
      )
    ),

    // Total row
    el(
      View,
      { key: `total-${sectionName}`, style: styles.totalRow },
      el(Text, { style: styles.totalLabel }, `Net cash from ${sectionName}`),
      el(Text, { style: styles.totalAmount }, section.total)
    )
  ];
}

// ─── Document Builder ────────────────────────────────────────────────────────

function buildCashFlowDocument(data: CashFlowPdfData) {
  const el = React.createElement;
  const generatedDate = formatDate(new Date());

  return el(
    Document,
    null,
    el(
      Page,
      { size: "A4", style: styles.page },

      // ── Header
      el(Text, { style: styles.entityName }, data.entityName.toUpperCase()),
      el(Text, { style: styles.title }, "STATEMENT OF CASH FLOWS"),
      el(Text, { style: styles.periodName }, data.periodName),

      // ── Operating Activities
      ...buildSection(el, data.operating, "operating"),

      // ── Investing Activities
      ...buildSection(el, data.investing, "investing"),

      // ── Financing Activities
      ...buildSection(el, data.financing, "financing"),

      // ── Separator
      el(View, { style: styles.separator }),

      // ── Summary: Net Change
      el(
        View,
        { style: styles.summaryRow },
        el(Text, { style: styles.summaryLabelBold }, "Net Change in Cash"),
        el(Text, { style: styles.summaryAmountBold }, data.netChange)
      ),

      // ── Summary: Opening Cash
      el(
        View,
        { style: styles.summaryRow },
        el(Text, { style: styles.summaryLabel }, "Opening Cash Balance"),
        el(Text, { style: styles.summaryAmount }, data.openingCash)
      ),

      // ── Summary: Closing Cash (navy background)
      el(
        View,
        { style: styles.closingRow },
        el(Text, { style: styles.closingLabel }, "Closing Cash Balance"),
        el(Text, { style: styles.closingAmount }, data.closingCash)
      ),

      // ── Footer
      el(Text, { style: styles.footer }, `Generated on ${generatedDate}`)
    )
  );
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function renderCashFlowPdf(data: CashFlowPdfData): Promise<Buffer> {
  const document = buildCashFlowDocument(data);
  return renderToBuffer(document);
}
