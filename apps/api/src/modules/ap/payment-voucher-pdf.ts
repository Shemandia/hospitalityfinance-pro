import { Prisma } from "@prisma/client";
import { Document, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import React from "react";
import { amountToWords } from "./number-to-words.js";

// ─── Data Types ──────────────────────────────────────────────────────────────

export type VoucherEntityInfo = {
  name: string;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  countryCode: string;
};

export type VoucherSupplierInfo = {
  name: string;
  code: string;
};

export type VoucherPaymentInfo = {
  reference: string;
  paymentDate: Date;
  currency: string;
  totalAmount: Prisma.Decimal;
  paymentMethod: string;
};

export type VoucherInvoiceLine = {
  invoiceNumber: string;
  invoiceDate: Date;
  description: string;
  debitAmount: Prisma.Decimal;
  creditAmount: Prisma.Decimal;
};

export type PaymentVoucherData = {
  entity: VoucherEntityInfo;
  supplier: VoucherSupplierInfo;
  payment: VoucherPaymentInfo;
  invoiceLines: VoucherInvoiceLine[];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(date: Date): string {
  const d = new Date(date);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatAmount(decimal: Prisma.Decimal): string {
  return Number(decimal).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const BLUE = "#1a3b6e";

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 9,
    fontFamily: "Helvetica"
  },

  // Header
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4
  },
  companyName: {
    fontSize: 11,
    fontWeight: "bold",
    color: BLUE
  },
  companyAddress: {
    fontSize: 8,
    color: "#333",
    lineHeight: 1.5
  },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    color: BLUE,
    textAlign: "center",
    marginTop: 14,
    marginBottom: 8
  },

  // Supplier subtitle
  subtitle: {
    fontSize: 10,
    marginBottom: 16,
    color: "#333"
  },

  // Remittance block
  remittanceBlock: {
    marginBottom: 10
  },
  remittanceRow: {
    flexDirection: "row",
    marginBottom: 2
  },
  remittanceLeft: {
    width: "50%",
    flexDirection: "row"
  },
  remittanceRight: {
    width: "50%",
    flexDirection: "row"
  },
  remittanceLabel: {
    fontWeight: "bold",
    fontSize: 9,
    color: BLUE
  },
  remittanceValue: {
    fontSize: 9,
    marginLeft: 4
  },

  // Transaction table
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#333",
    paddingBottom: 4,
    paddingTop: 4,
    marginTop: 8,
    fontWeight: "bold",
    fontSize: 8
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#ddd",
    paddingVertical: 4,
    fontSize: 8
  },
  colDocRef: { width: "18%" },
  colTxnDate: { width: "17%" },
  colDesc: { width: "35%" },
  colDebit: { width: "15%", textAlign: "right" },
  colCredit: { width: "15%", textAlign: "right" },

  // Dashed separator
  dashedLine: {
    borderBottomWidth: 1,
    borderBottomColor: "#000",
    borderBottomStyle: "dashed",
    marginTop: 30,
    marginBottom: 12
  },

  // Cheque stub
  chequeRow: {
    flexDirection: "row",
    marginBottom: 3
  },
  chequeLabel: {
    fontWeight: "bold",
    fontSize: 9,
    color: BLUE
  },
  chequeValue: {
    fontSize: 9,
    marginLeft: 4
  },
  chequeAmountRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 2
  },
  amountInWords: {
    fontSize: 9,
    maxWidth: "75%"
  },
  amountNumeric: {
    fontSize: 9,
    fontWeight: "bold",
    textAlign: "right"
  },

  // Signature block
  signatureBlock: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 40
  },
  signatureColumn: {
    width: "22%",
    alignItems: "center"
  },
  signatureLine: {
    borderBottomWidth: 1,
    borderBottomColor: "#000",
    width: "100%",
    marginBottom: 4,
    marginTop: 30
  },
  signatureLabel: {
    fontSize: 8,
    fontWeight: "bold",
    textAlign: "center"
  },
  signatureRole: {
    fontSize: 7,
    textAlign: "center",
    color: "#666"
  }
});

// ─── Document Builder ────────────────────────────────────────────────────────

function buildPaymentVoucherDocument(data: PaymentVoucherData) {
  const { entity, supplier, payment, invoiceLines } = data;
  const dateStr = formatDate(payment.paymentDate);
  const totalStr = formatAmount(payment.totalAmount);
  const wordsStr = amountToWords(payment.totalAmount.toNumber(), payment.currency);

  const addressLines: string[] = [];
  if (entity.address) addressLines.push(entity.address);
  if (entity.postalCode) addressLines.push(entity.postalCode);
  if (entity.city) addressLines.push(entity.city);

  const el = React.createElement;

  return el(
    Document,
    null,
    el(
      Page,
      { size: "A4", style: styles.page },

      // ── Header: company info
      el(
        View,
        { style: styles.headerRow },
        el(
          View,
          null,
          el(Text, { style: styles.companyName }, entity.name.toUpperCase()),
          ...addressLines.map((line, i) =>
            el(Text, { key: `addr-${i}`, style: styles.companyAddress }, line.toUpperCase())
          )
        )
      ),

      // ── Title
      el(Text, { style: styles.title }, "PAYMENT VOUCHER"),

      // ── Supplier subtitle
      el(Text, { style: styles.subtitle }, supplier.name),

      // ── Remittance block
      el(
        View,
        { style: styles.remittanceBlock },
        // Row 1: Remittance Date / Supplier Name
        el(
          View,
          { style: styles.remittanceRow },
          el(
            View,
            { style: styles.remittanceLeft },
            el(Text, { style: styles.remittanceLabel }, "Remittance Date: "),
            el(Text, { style: styles.remittanceValue }, dateStr)
          ),
          el(
            View,
            { style: styles.remittanceRight },
            el(Text, { style: styles.remittanceLabel }, "Supplier Name: "),
            el(Text, { style: styles.remittanceValue }, supplier.name.toUpperCase())
          )
        ),
        // Row 2: Account Code / Total Payments
        el(
          View,
          { style: styles.remittanceRow },
          el(
            View,
            { style: styles.remittanceLeft },
            el(Text, { style: styles.remittanceLabel }, "Account Code: "),
            el(Text, { style: styles.remittanceValue }, supplier.code)
          ),
          el(
            View,
            { style: styles.remittanceRight },
            el(Text, { style: styles.remittanceLabel }, "Total Payments: "),
            el(Text, { style: styles.remittanceValue }, `${totalStr} ${payment.currency}`)
          )
        ),
        // Row 3: Cheque Ref
        el(
          View,
          { style: styles.remittanceRow },
          el(
            View,
            { style: styles.remittanceLeft },
            el(Text, { style: styles.remittanceLabel }, "Cheque Ref: "),
            el(Text, { style: styles.remittanceValue }, payment.reference)
          )
        )
      ),

      // ── Transaction table header
      el(
        View,
        { style: styles.tableHeader },
        el(Text, { style: styles.colDocRef }, "Document\nReference"),
        el(Text, { style: styles.colTxnDate }, "Transaction\nDate"),
        el(Text, { style: styles.colDesc }, "Description"),
        el(Text, { style: styles.colDebit }, "Debit Amount"),
        el(Text, { style: styles.colCredit }, "Credit Amount")
      ),

      // ── Transaction table rows
      ...invoiceLines.map((line, idx) =>
        el(
          View,
          { key: `inv-${idx}`, style: styles.tableRow },
          el(Text, { style: styles.colDocRef }, line.invoiceNumber),
          el(Text, { style: styles.colTxnDate }, formatDate(line.invoiceDate)),
          el(Text, { style: styles.colDesc }, line.description),
          el(Text, { style: styles.colDebit }, formatAmount(line.debitAmount)),
          el(Text, { style: styles.colCredit }, formatAmount(line.creditAmount))
        )
      ),

      // ── Dashed separator
      el(View, { style: styles.dashedLine }),

      // ── Cheque stub
      el(
        View,
        null,
        // Account Code + Date
        el(
          View,
          { style: styles.chequeRow },
          el(Text, { style: styles.chequeLabel }, "Account Code: "),
          el(Text, { style: styles.chequeValue }, supplier.code),
          el(Text, { style: { ...styles.chequeValue, marginLeft: 24 } }, dateStr)
        ),
        // PAY line
        el(
          View,
          { style: styles.chequeRow },
          el(Text, { style: styles.chequeLabel }, "PAY: "),
          el(Text, { style: styles.chequeValue }, supplier.name.toUpperCase())
        ),
        // Amount in words + numeric
        el(
          View,
          { style: styles.chequeAmountRow },
          el(Text, { style: styles.amountInWords }, wordsStr),
          el(
            View,
            { style: { alignItems: "flex-end" } },
            el(Text, { style: { fontSize: 7, color: "#666" } }, "Amount"),
            el(Text, { style: styles.amountNumeric }, `${totalStr}  ${payment.currency}`)
          )
        )
      ),

      // ── Signature block
      el(
        View,
        { style: styles.signatureBlock },
        // Prepared By
        el(
          View,
          { style: styles.signatureColumn },
          el(Text, { style: styles.signatureLabel }, "PREPARED"),
          el(View, { style: styles.signatureLine }),
          el(Text, { style: styles.signatureRole }, "ACCOUNTS PAYABLE")
        ),
        // Authorized By
        el(
          View,
          { style: styles.signatureColumn },
          el(Text, { style: styles.signatureLabel }, "AUTHORIZED BY:"),
          el(View, { style: styles.signatureLine }),
          el(Text, { style: styles.signatureRole }, "FINANCIAL CONTROLLER")
        ),
        // Checked By
        el(
          View,
          { style: styles.signatureColumn },
          el(Text, { style: styles.signatureLabel }, "CHECKED BY:"),
          el(View, { style: styles.signatureLine }),
          el(Text, { style: styles.signatureRole }, "")
        ),
        // Approved By
        el(
          View,
          { style: styles.signatureColumn },
          el(Text, { style: styles.signatureLabel }, "APPROVED BY:"),
          el(View, { style: styles.signatureLine }),
          el(Text, { style: styles.signatureRole }, "GENERAL MANAGER")
        )
      )
    )
  );
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function renderPaymentVoucherPdf(data: PaymentVoucherData): Promise<Buffer> {
  const document = buildPaymentVoucherDocument(data);
  return renderToBuffer(document);
}
