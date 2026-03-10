import { type OperaCloudCredentials, getOperaCloudToken } from "./opera-cloud-auth.js";

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

export class OperaCloudClient {
  constructor(private readonly creds: OperaCloudCredentials) {}

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await getOperaCloudToken(this.creds);
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-hotelId": this.creds.enterpriseId
    };
  }

  async getRevenueSummary(
    hotelId: string,
    businessDate: string
  ): Promise<OhipRevenueTrialBalance> {
    const url = `${this.creds.hostname}/rev/v1/revenueManagement/revenueTrialBalance?hotelId=${encodeURIComponent(hotelId)}&date=${businessDate}`;
    const headers = await this.authHeaders();

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
}
