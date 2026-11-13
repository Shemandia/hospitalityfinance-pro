import { Prisma } from "../../../../db/client.js";
import { config } from "../../../../config.js";

/**
 * Mews PMS — REST API Client
 *
 * Mews uses a REST API with API key authentication (ClientToken + AccessToken).
 * All API calls are POST requests with JSON body.
 *
 * Key endpoints:
 *   - POST /api/connector/v1/accountingItems/getAll     — revenue items for a date range
 *   - POST /api/connector/v1/outletItems/getAll          — POS/outlet revenue
 *   - POST /api/connector/v1/services/getAll             — room revenue by service
 *   - POST /api/connector/v1/reservations/getAll         — occupancy data
 *
 * Env vars:
 *   MEWS_CLIENT_TOKEN   — platform-level client token
 *   MEWS_ACCESS_TOKEN   — property-level access token
 *   MEWS_HOSTNAME       — API base URL (default: https://api.mews.com)
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type MewsCredentials = {
  clientToken: string;
  accessToken: string;
  hostname: string;
};

export type MewsAccountingItem = {
  id: string;
  name: string;
  type: string;
  amount: string;
  currency: string;
  consumedUtc: string;
  accountingCategoryId: string;
};

export type MewsOutletItem = {
  id: string;
  outletId: string;
  name: string;
  unitAmount: string;
  quantity: number;
  amount: string;
  currency: string;
  consumedUtc: string;
  accountingCategoryId: string;
};

export type MewsService = {
  id: string;
  name: string;
  type: string; // "Reservable" for room revenue
};

export type MewsReservation = {
  id: string;
  state: string;
  startUtc: string;
  endUtc: string;
  adultCount: number;
  childCount: number;
  serviceId: string;
};

export type MewsAccountingCategory = {
  id: string;
  name: string;
  code: string;
  classification: string; // e.g. "Revenue", "Payment", "Tax"
};

export type MewsDailySummary = {
  date: string;
  currency: string;
  items: MewsAccountingItem[];
  outletItems: MewsOutletItem[];
  totalRevenue: string;
  totalTax: string;
  totalPayments: string;
  byCategory: Array<{
    accountingCategoryId: string;
    categoryName: string;
    amount: string;
    type: string;
  }>;
};

// ── Credentials helper ────────────────────────────────────────────────────────

export function getMewsCredentials(): MewsCredentials {
  const cfg = config();
  const clientToken = cfg.MEWS_CLIENT_TOKEN;
  const accessToken = cfg.MEWS_ACCESS_TOKEN;
  const hostname = cfg.MEWS_HOSTNAME;

  if (!clientToken) throw new Error("MEWS_CLIENT_TOKEN env var is required");
  if (!accessToken) throw new Error("MEWS_ACCESS_TOKEN env var is required");

  return { clientToken, accessToken, hostname };
}

// ── Client ────────────────────────────────────────────────────────────────────

export class MewsClient {
  constructor(private readonly creds: MewsCredentials) {}

  private async post<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    const url = `${this.creds.hostname}${endpoint}`;
    const payload = {
      ClientToken: this.creds.clientToken,
      AccessToken: this.creds.accessToken,
      ...body
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Mews API ${endpoint} failed: ${response.status} ${text}`);
    }

    return (await response.json()) as T;
  }

  /**
   * Fetch all accounting items (revenue postings) for a UTC date range.
   */
  async getAccountingItems(startUtc: string, endUtc: string): Promise<MewsAccountingItem[]> {
    type RawResponse = {
      AccountingItems?: Array<{
        Id?: string;
        Name?: string;
        Type?: string;
        Amount?: { Value?: number; Currency?: string };
        ConsumedUtc?: string;
        AccountingCategoryId?: string;
      }>;
    };

    const raw = await this.post<RawResponse>("/api/connector/v1/accountingItems/getAll", {
      TimeFilter: "Consumed",
      StartUtc: startUtc,
      EndUtc: endUtc,
      Limitation: { Count: 10000 }
    });

    return (raw.AccountingItems ?? []).map((item) => ({
      id: item.Id ?? "",
      name: item.Name ?? "",
      type: item.Type ?? "",
      amount: new Prisma.Decimal(item.Amount?.Value ?? 0).toDecimalPlaces(4).toString(),
      currency: (item.Amount?.Currency ?? "USD").toUpperCase(),
      consumedUtc: item.ConsumedUtc ?? "",
      accountingCategoryId: item.AccountingCategoryId ?? ""
    }));
  }

  /**
   * Fetch outlet (POS) items for a UTC date range.
   */
  async getOutletItems(startUtc: string, endUtc: string): Promise<MewsOutletItem[]> {
    type RawResponse = {
      OutletItems?: Array<{
        Id?: string;
        OutletId?: string;
        Name?: string;
        UnitAmount?: { Value?: number; Currency?: string };
        UnitCount?: number;
        Amount?: { Value?: number; Currency?: string };
        ConsumedUtc?: string;
        AccountingCategoryId?: string;
      }>;
    };

    const raw = await this.post<RawResponse>("/api/connector/v1/outletItems/getAll", {
      TimeFilter: "Consumed",
      StartUtc: startUtc,
      EndUtc: endUtc,
      Limitation: { Count: 10000 }
    });

    return (raw.OutletItems ?? []).map((item) => ({
      id: item.Id ?? "",
      outletId: item.OutletId ?? "",
      name: item.Name ?? "",
      unitAmount: new Prisma.Decimal(item.UnitAmount?.Value ?? 0).toDecimalPlaces(4).toString(),
      quantity: item.UnitCount ?? 0,
      amount: new Prisma.Decimal(item.Amount?.Value ?? 0).toDecimalPlaces(4).toString(),
      currency: (item.Amount?.Currency ?? "USD").toUpperCase(),
      consumedUtc: item.ConsumedUtc ?? "",
      accountingCategoryId: item.AccountingCategoryId ?? ""
    }));
  }

  /**
   * Fetch services (room revenue types).
   */
  async getServices(): Promise<MewsService[]> {
    type RawResponse = {
      Services?: Array<{
        Id?: string;
        Name?: string;
        Type?: string;
      }>;
    };

    const raw = await this.post<RawResponse>("/api/connector/v1/services/getAll", {});

    return (raw.Services ?? []).map((svc) => ({
      id: svc.Id ?? "",
      name: svc.Name ?? "",
      type: svc.Type ?? ""
    }));
  }

  /**
   * Fetch reservations for occupancy data.
   */
  async getReservations(startUtc: string, endUtc: string): Promise<MewsReservation[]> {
    type RawResponse = {
      Reservations?: Array<{
        Id?: string;
        State?: string;
        StartUtc?: string;
        EndUtc?: string;
        AdultCount?: number;
        ChildCount?: number;
        ServiceId?: string;
      }>;
    };

    const raw = await this.post<RawResponse>("/api/connector/v1/reservations/getAll", {
      TimeFilter: "Start",
      StartUtc: startUtc,
      EndUtc: endUtc,
      States: ["Started", "Processed"],
      Limitation: { Count: 10000 }
    });

    return (raw.Reservations ?? []).map((r) => ({
      id: r.Id ?? "",
      state: r.State ?? "",
      startUtc: r.StartUtc ?? "",
      endUtc: r.EndUtc ?? "",
      adultCount: r.AdultCount ?? 0,
      childCount: r.ChildCount ?? 0,
      serviceId: r.ServiceId ?? ""
    }));
  }

  /**
   * Fetch accounting categories (for mapping reference).
   */
  async getAccountingCategories(): Promise<MewsAccountingCategory[]> {
    type RawResponse = {
      AccountingCategories?: Array<{
        Id?: string;
        Name?: string;
        Code?: string;
        Classification?: string;
      }>;
    };

    const raw = await this.post<RawResponse>("/api/connector/v1/accountingCategories/getAll", {});

    return (raw.AccountingCategories ?? []).map((cat) => ({
      id: cat.Id ?? "",
      name: cat.Name ?? "",
      code: cat.Code ?? "",
      classification: cat.Classification ?? ""
    }));
  }

  /**
   * Build a daily summary by aggregating accounting items by category.
   */
  async getDailySummary(startUtc: string, endUtc: string): Promise<MewsDailySummary> {
    const [items, outletItems, categories] = await Promise.all([
      this.getAccountingItems(startUtc, endUtc),
      this.getOutletItems(startUtc, endUtc),
      this.getAccountingCategories()
    ]);

    const categoryMap = new Map<string, MewsAccountingCategory>();
    for (const cat of categories) {
      categoryMap.set(cat.id, cat);
    }

    // Aggregate by accounting category using Decimal for precision
    const byCategoryAgg = new Map<
      string,
      { accountingCategoryId: string; categoryName: string; amount: Prisma.Decimal; type: string }
    >();

    let totalRevenue = new Prisma.Decimal(0);
    let totalTax = new Prisma.Decimal(0);
    let totalPayments = new Prisma.Decimal(0);
    const currency = items[0]?.currency ?? outletItems[0]?.currency ?? "USD";

    for (const item of items) {
      const cat = categoryMap.get(item.accountingCategoryId);
      const classification = cat?.classification ?? "Unknown";
      const itemAmount = new Prisma.Decimal(item.amount);

      const existing = byCategoryAgg.get(item.accountingCategoryId);
      if (existing) {
        existing.amount = existing.amount.add(itemAmount);
      } else {
        byCategoryAgg.set(item.accountingCategoryId, {
          accountingCategoryId: item.accountingCategoryId,
          categoryName: cat?.name ?? "Unknown",
          amount: itemAmount,
          type: classification
        });
      }

      if (classification === "Revenue") totalRevenue = totalRevenue.add(itemAmount);
      else if (classification === "Tax") totalTax = totalTax.add(itemAmount);
      else if (classification === "Payment") totalPayments = totalPayments.add(itemAmount);
    }

    // Include outlet items in revenue
    for (const item of outletItems) {
      const cat = categoryMap.get(item.accountingCategoryId);
      const classification = cat?.classification ?? "Unknown";
      const itemAmount = new Prisma.Decimal(item.amount);

      const existing = byCategoryAgg.get(item.accountingCategoryId);
      if (existing) {
        existing.amount = existing.amount.add(itemAmount);
      } else {
        byCategoryAgg.set(item.accountingCategoryId, {
          accountingCategoryId: item.accountingCategoryId,
          categoryName: cat?.name ?? "Unknown",
          amount: itemAmount,
          type: classification
        });
      }

      if (classification === "Revenue") totalRevenue = totalRevenue.add(itemAmount);
    }

    return {
      date: startUtc.split("T")[0] ?? startUtc,
      currency: currency.toUpperCase(),
      items,
      outletItems,
      totalRevenue: totalRevenue.toString(),
      totalTax: totalTax.toString(),
      totalPayments: totalPayments.toString(),
      byCategory: Array.from(byCategoryAgg.values()).map((c) => ({
        ...c,
        amount: c.amount.toString()
      }))
    };
  }
}
