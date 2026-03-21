/**
 * Oracle Simphony POS — OHIP API Client
 *
 * Simphony exposes POS transaction data via the same Oracle Hospitality
 * Integration Platform (OHIP) that Opera Cloud uses.  We reuse the shared
 * OHIP OAuth 2.0 token from opera-cloud-auth.ts.
 *
 * Key OHIP endpoints for Simphony:
 *   - GET /pos/v1/transactionServices/transactionSummary  → daily revenue by revenue centre
 *   - GET /pos/v1/transactionServices/checkDetails         → individual check breakdown
 *   - GET /pos/v1/menuItems/revenueItems                   → menu item master
 */

import { type OperaCloudCredentials, getOperaCloudToken } from "../opera-cloud/opera-cloud-auth.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SimphonyRevenueCentre = {
  revenueCentreId: string;
  revenueCentreName: string;
};

export type SimphonyTransactionLine = {
  menuItemId: string;
  menuItemName: string;
  revenueCentreId: string;
  revenueCentreName: string;
  quantity: number;
  amount: number;
  currency: string;
  taxAmount: number;
  discountAmount: number;
  serviceChargeAmount: number;
  revenueClassCode: string;
  revenueClassName: string;
};

export type SimphonyDailySummary = {
  locationId: string;
  businessDate: string;
  currency: string;
  totalGrossSales: number;
  totalNetSales: number;
  totalTax: number;
  totalDiscount: number;
  totalServiceCharge: number;
  totalTips: number;
  checkCount: number;
  coverCount: number;
  lines: SimphonyTransactionLine[];
};

export type SimphonyCheckDetail = {
  checkId: string;
  checkNumber: string;
  revenueCentreId: string;
  revenueCentreName: string;
  openTime: string;
  closeTime: string;
  guestCount: number;
  subTotal: number;
  tax: number;
  serviceCharge: number;
  discount: number;
  total: number;
  currency: string;
  employeeId: string;
  employeeName: string;
  paymentMethod: string;
  items: Array<{
    menuItemId: string;
    menuItemName: string;
    quantity: number;
    unitPrice: number;
    amount: number;
    revenueClassCode: string;
  }>;
};

// ── Client ────────────────────────────────────────────────────────────────────

export class SimphonyClient {
  constructor(private readonly creds: OperaCloudCredentials) {}

  private async authHeaders(locationId: string): Promise<Record<string, string>> {
    const token = await getOperaCloudToken(this.creds);
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-hotelId": locationId // Simphony uses locationId via same header
    };
  }

  /**
   * Fetch daily POS transaction summary by revenue centre.
   */
  async getDailyTransactionSummary(
    locationId: string,
    businessDate: string
  ): Promise<SimphonyDailySummary> {
    const url =
      `${this.creds.hostname}/pos/v1/transactionServices/transactionSummary` +
      `?locationId=${encodeURIComponent(locationId)}&businessDate=${businessDate}`;

    const headers = await this.authHeaders(locationId);
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(30_000)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Simphony transaction summary failed: ${response.status} ${text}`);
    }

    const raw = (await response.json()) as {
      transactionSummary?: {
        locationId?: string;
        businessDate?: string;
        currency?: string;
        totals?: {
          grossSales?: number;
          netSales?: number;
          tax?: number;
          discount?: number;
          serviceCharge?: number;
          tips?: number;
          checkCount?: number;
          coverCount?: number;
        };
        revenueItems?: Array<{
          menuItemId?: string;
          menuItemName?: string;
          revenueCentreId?: string;
          revenueCentreName?: string;
          quantity?: number;
          amount?: number;
          currencyCode?: string;
          taxAmount?: number;
          discountAmount?: number;
          serviceChargeAmount?: number;
          revenueClassCode?: string;
          revenueClassName?: string;
        }>;
      };
    };

    const summary = raw.transactionSummary ?? {};
    const totals = summary.totals ?? {};

    return {
      locationId: summary.locationId ?? locationId,
      businessDate: summary.businessDate ?? businessDate,
      currency: (summary.currency ?? "USD").toUpperCase(),
      totalGrossSales: totals.grossSales ?? 0,
      totalNetSales: totals.netSales ?? 0,
      totalTax: totals.tax ?? 0,
      totalDiscount: totals.discount ?? 0,
      totalServiceCharge: totals.serviceCharge ?? 0,
      totalTips: totals.tips ?? 0,
      checkCount: totals.checkCount ?? 0,
      coverCount: totals.coverCount ?? 0,
      lines: (summary.revenueItems ?? []).map((item) => ({
        menuItemId: item.menuItemId ?? "",
        menuItemName: item.menuItemName ?? "",
        revenueCentreId: item.revenueCentreId ?? "",
        revenueCentreName: item.revenueCentreName ?? "",
        quantity: item.quantity ?? 0,
        amount: item.amount ?? 0,
        currency: (item.currencyCode ?? summary.currency ?? "USD").toUpperCase(),
        taxAmount: item.taxAmount ?? 0,
        discountAmount: item.discountAmount ?? 0,
        serviceChargeAmount: item.serviceChargeAmount ?? 0,
        revenueClassCode: item.revenueClassCode ?? "",
        revenueClassName: item.revenueClassName ?? ""
      }))
    };
  }

  /**
   * Fetch individual check details for a business date.
   */
  async getCheckDetails(
    locationId: string,
    businessDate: string,
    limit = 200
  ): Promise<SimphonyCheckDetail[]> {
    const url =
      `${this.creds.hostname}/pos/v1/transactionServices/checkDetails` +
      `?locationId=${encodeURIComponent(locationId)}&businessDate=${businessDate}&limit=${limit}`;

    const headers = await this.authHeaders(locationId);
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(60_000)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Simphony check details failed: ${response.status} ${text}`);
    }

    const raw = (await response.json()) as {
      checks?: Array<{
        checkId?: string;
        checkNumber?: string;
        revenueCentreId?: string;
        revenueCentreName?: string;
        openTime?: string;
        closeTime?: string;
        guestCount?: number;
        subTotal?: number;
        tax?: number;
        serviceCharge?: number;
        discount?: number;
        total?: number;
        currency?: string;
        employeeId?: string;
        employeeName?: string;
        paymentMethod?: string;
        items?: Array<{
          menuItemId?: string;
          menuItemName?: string;
          quantity?: number;
          unitPrice?: number;
          amount?: number;
          revenueClassCode?: string;
        }>;
      }>;
    };

    return (raw.checks ?? []).map((c) => ({
      checkId: c.checkId ?? "",
      checkNumber: c.checkNumber ?? "",
      revenueCentreId: c.revenueCentreId ?? "",
      revenueCentreName: c.revenueCentreName ?? "",
      openTime: c.openTime ?? "",
      closeTime: c.closeTime ?? "",
      guestCount: c.guestCount ?? 0,
      subTotal: c.subTotal ?? 0,
      tax: c.tax ?? 0,
      serviceCharge: c.serviceCharge ?? 0,
      discount: c.discount ?? 0,
      total: c.total ?? 0,
      currency: (c.currency ?? "USD").toUpperCase(),
      employeeId: c.employeeId ?? "",
      employeeName: c.employeeName ?? "",
      paymentMethod: c.paymentMethod ?? "",
      items: (c.items ?? []).map((item) => ({
        menuItemId: item.menuItemId ?? "",
        menuItemName: item.menuItemName ?? "",
        quantity: item.quantity ?? 0,
        unitPrice: item.unitPrice ?? 0,
        amount: item.amount ?? 0,
        revenueClassCode: item.revenueClassCode ?? ""
      }))
    }));
  }

  /**
   * Fetch revenue centres for a location.
   */
  async getRevenueCentres(locationId: string): Promise<SimphonyRevenueCentre[]> {
    const url =
      `${this.creds.hostname}/pos/v1/configuration/revenueCentres` +
      `?locationId=${encodeURIComponent(locationId)}`;

    const headers = await this.authHeaders(locationId);
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(15_000)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Simphony revenue centres failed: ${response.status} ${text}`);
    }

    const raw = (await response.json()) as {
      revenueCentres?: Array<{
        revenueCentreId?: string;
        revenueCentreName?: string;
      }>;
    };

    return (raw.revenueCentres ?? []).map((rc) => ({
      revenueCentreId: rc.revenueCentreId ?? "",
      revenueCentreName: rc.revenueCentreName ?? ""
    }));
  }
}
