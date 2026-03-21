/**
 * Oracle Opera Cloud PMS — OHIP API Client
 *
 * Endpoints used:
 *   - GET /rev/v1/revenueManagement/revenueTrialBalance  → daily revenue posting
 *   - GET /csh/v1/cashiering/cashierReports               → cashier shift reports
 *   - GET /fof/v1/hotels/{hotelId}/statistics              → occupancy/ADR stats
 *   - GET /ars/v1/accounts/arAccounts                      → city ledger balances
 *   - GET /hsk/v1/hotels/{hotelId}/housekeepingStatistics  → room status summary
 */

import { type OperaCloudCredentials, getOperaCloudToken } from "./opera-cloud-auth.js";

// ── Revenue types (existing) ──────────────────────────────────────────────────

export type OhipRevenueTransaction = {
  transactionCode: string;
  transactionDescription: string;
  amount: number;
  currency: string;
  businessDate: string;
};

export type OhipRevenueTrialBalance = {
  hotelId: string;
  businessDate: string;
  transactions: OhipRevenueTransaction[];
};

// ── Housekeeping / Statistics types ───────────────────────────────────────────

export type OhipHotelStatistics = {
  hotelId: string;
  businessDate: string;
  totalRooms: number;
  roomsSold: number;
  occupancyPct: number;
  averageDailyRate: number;
  revPAR: number;
  arrivalRooms: number;
  departureRooms: number;
  dayUseRooms: number;
  complimentaryRooms: number;
  houseUseRooms: number;
  outOfOrderRooms: number;
  currency: string;
};

// ── Cashier report types ──────────────────────────────────────────────────────

export type OhipCashierShift = {
  cashierId: string;
  cashierName: string;
  shiftNumber: number;
  openTime: string;
  closeTime: string;
  totalPayments: number;
  totalReceipts: number;
  netAmount: number;
  currency: string;
  paymentBreakdown: Array<{
    paymentMethod: string;
    amount: number;
  }>;
};

export type OhipCashierReport = {
  hotelId: string;
  businessDate: string;
  shifts: OhipCashierShift[];
};

// ── City Ledger (AR) types ────────────────────────────────────────────────────

export type OhipCityLedgerAccount = {
  accountId: string;
  accountName: string;
  accountType: string;
  balance: number;
  currency: string;
};

export type OhipCityLedgerSummary = {
  hotelId: string;
  businessDate: string;
  accounts: OhipCityLedgerAccount[];
  totalBalance: number;
  currency: string;
};

// ── Client ────────────────────────────────────────────────────────────────────

export class OperaCloudClient {
  constructor(private readonly creds: OperaCloudCredentials) {}

  private async authHeaders(hotelId?: string): Promise<Record<string, string>> {
    const token = await getOperaCloudToken(this.creds);
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-hotelId": hotelId ?? this.creds.enterpriseId
    };
  }

  // ── Revenue Trial Balance ─────────────────────────────────────────────────

  async getRevenueSummary(hotelId: string, businessDate: string): Promise<OhipRevenueTrialBalance> {
    const url = `${this.creds.hostname}/rev/v1/revenueManagement/revenueTrialBalance?hotelId=${encodeURIComponent(hotelId)}&date=${businessDate}`;
    const headers = await this.authHeaders(hotelId);

    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(30_000)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OHIP revenue summary failed: ${response.status} ${text}`);
    }

    const raw = (await response.json()) as {
      revenueTrialBalance?: {
        hotelId?: string;
        businessDate?: string;
        transactions?: Array<{
          transactionCode?: string;
          transactionDescription?: string;
          amount?: number;
          currencyCode?: string;
        }>;
      };
    };

    const tb = raw.revenueTrialBalance ?? {};
    return {
      hotelId: tb.hotelId ?? hotelId,
      businessDate: tb.businessDate ?? businessDate,
      transactions: (tb.transactions ?? []).map((t) => ({
        transactionCode: t.transactionCode ?? "",
        transactionDescription: t.transactionDescription ?? "",
        amount: t.amount ?? 0,
        currency: t.currencyCode ?? "USD",
        businessDate
      }))
    };
  }

  // ── Hotel Statistics (Occupancy / ADR / RevPAR) ───────────────────────────

  async getHotelStatistics(hotelId: string, businessDate: string): Promise<OhipHotelStatistics> {
    const url = `${this.creds.hostname}/fof/v1/hotels/${encodeURIComponent(hotelId)}/statistics?date=${businessDate}`;
    const headers = await this.authHeaders(hotelId);

    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(30_000)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OHIP hotel statistics failed: ${response.status} ${text}`);
    }

    const raw = (await response.json()) as {
      hotelStatistics?: {
        totalRooms?: number;
        roomsSold?: number;
        occupancyPercentage?: number;
        averageDailyRate?: number;
        revPAR?: number;
        arrivalRooms?: number;
        departureRooms?: number;
        dayUseRooms?: number;
        complimentaryRooms?: number;
        houseUseRooms?: number;
        outOfOrderRooms?: number;
        currencyCode?: string;
      };
    };

    const stats = raw.hotelStatistics ?? {};
    return {
      hotelId,
      businessDate,
      totalRooms: stats.totalRooms ?? 0,
      roomsSold: stats.roomsSold ?? 0,
      occupancyPct: stats.occupancyPercentage ?? 0,
      averageDailyRate: stats.averageDailyRate ?? 0,
      revPAR: stats.revPAR ?? 0,
      arrivalRooms: stats.arrivalRooms ?? 0,
      departureRooms: stats.departureRooms ?? 0,
      dayUseRooms: stats.dayUseRooms ?? 0,
      complimentaryRooms: stats.complimentaryRooms ?? 0,
      houseUseRooms: stats.houseUseRooms ?? 0,
      outOfOrderRooms: stats.outOfOrderRooms ?? 0,
      currency: (stats.currencyCode ?? "USD").toUpperCase()
    };
  }

  // ── Cashier Reports ───────────────────────────────────────────────────────

  async getCashierReport(hotelId: string, businessDate: string): Promise<OhipCashierReport> {
    const url = `${this.creds.hostname}/csh/v1/cashiering/cashierReports?hotelId=${encodeURIComponent(hotelId)}&date=${businessDate}`;
    const headers = await this.authHeaders(hotelId);

    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(30_000)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OHIP cashier report failed: ${response.status} ${text}`);
    }

    const raw = (await response.json()) as {
      cashierShifts?: Array<{
        cashierId?: string;
        cashierName?: string;
        shiftNumber?: number;
        openTime?: string;
        closeTime?: string;
        totalPayments?: number;
        totalReceipts?: number;
        netAmount?: number;
        currencyCode?: string;
        paymentBreakdown?: Array<{
          paymentMethod?: string;
          amount?: number;
        }>;
      }>;
    };

    return {
      hotelId,
      businessDate,
      shifts: (raw.cashierShifts ?? []).map((s) => ({
        cashierId: s.cashierId ?? "",
        cashierName: s.cashierName ?? "",
        shiftNumber: s.shiftNumber ?? 0,
        openTime: s.openTime ?? "",
        closeTime: s.closeTime ?? "",
        totalPayments: s.totalPayments ?? 0,
        totalReceipts: s.totalReceipts ?? 0,
        netAmount: s.netAmount ?? 0,
        currency: (s.currencyCode ?? "USD").toUpperCase(),
        paymentBreakdown: (s.paymentBreakdown ?? []).map((p) => ({
          paymentMethod: p.paymentMethod ?? "",
          amount: p.amount ?? 0
        }))
      }))
    };
  }

  // ── City Ledger / AR Accounts ─────────────────────────────────────────────

  async getCityLedgerSummary(
    hotelId: string,
    businessDate: string
  ): Promise<OhipCityLedgerSummary> {
    const url = `${this.creds.hostname}/ars/v1/accounts/arAccounts?hotelId=${encodeURIComponent(hotelId)}&date=${businessDate}`;
    const headers = await this.authHeaders(hotelId);

    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(30_000)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OHIP city ledger failed: ${response.status} ${text}`);
    }

    const raw = (await response.json()) as {
      arAccounts?: Array<{
        accountId?: string;
        accountName?: string;
        accountType?: string;
        balance?: number;
        currencyCode?: string;
      }>;
    };

    const accounts = (raw.arAccounts ?? []).map((a) => ({
      accountId: a.accountId ?? "",
      accountName: a.accountName ?? "",
      accountType: a.accountType ?? "",
      balance: a.balance ?? 0,
      currency: (a.currencyCode ?? "USD").toUpperCase()
    }));

    const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);
    const currency = accounts[0]?.currency ?? "USD";

    return { hotelId, businessDate, accounts, totalBalance, currency };
  }
}
