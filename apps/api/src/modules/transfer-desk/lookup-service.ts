import type { PrismaClient } from "../../db/client.js";
import type { LookupTableCreateInput, LookupTableUpdateInput } from "./lookup-types.js";

// ── Error ────────────────────────────────────────────────────────────────────

export class LookupServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
  }
}

// ── Service ──────────────────────────────────────────────────────────────────

export class LookupService {
  constructor(private readonly prisma: PrismaClient) {}

  // ── List ──────────────────────────────────────────────────────────────────

  async list() {
    const db = this.prisma as any;

    const tables = await db.transferLookupTable.findMany({
      orderBy: { name: "asc" },
      include: {
        columns: {
          orderBy: { columnOrder: "asc" },
          select: { id: true, name: true, columnOrder: true }
        },
        _count: { select: { rows: true } }
      }
    });

    return tables;
  }

  // ── Get with entries ──────────────────────────────────────────────────────

  async get(tableId: string) {
    const db = this.prisma as any;

    const table = await db.transferLookupTable.findUnique({
      where: { id: tableId },
      include: {
        columns: {
          orderBy: { columnOrder: "asc" }
        },
        rows: {
          orderBy: { rowOrder: "asc" },
          include: {
            values: {
              include: {
                column: { select: { name: true } }
              }
            }
          }
        }
      }
    });

    if (!table) {
      throw new LookupServiceError("LOOKUP_TABLE_NOT_FOUND", "Lookup table not found.", 404);
    }

    // Flatten rows into a friendlier shape:
    // { id, businessUnit, rangeFrom, rangeTo, values: { colName: value } }
    const flatRows = table.rows.map((row: any) => {
      const values: Record<string, string | null> = {};
      for (const v of row.values) {
        values[v.column.name] = v.valueParam;
      }
      return {
        id: row.id,
        businessUnit: row.businessUnit,
        rangeFrom: row.rangeFrom,
        rangeTo: row.rangeTo,
        rowOrder: row.rowOrder,
        values
      };
    });

    return {
      id: table.id,
      name: table.name,
      description: table.description,
      columns: table.columns.map((c: any) => c.name),
      rows: flatRows,
      createdAt: table.createdAt,
      updatedAt: table.updatedAt
    };
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async create(userId: string, input: LookupTableCreateInput) {
    const db = this.prisma as any;

    // Unique name check
    const existing = await db.transferLookupTable.findFirst({
      where: { name: input.name }
    });
    if (existing) {
      throw new LookupServiceError(
        "LOOKUP_TABLE_DUPLICATE_NAME",
        `A lookup table named "${input.name}" already exists.`,
        409
      );
    }

    // Create table + columns + optional rows in a transaction
    const table = await this.prisma.$transaction(async (tx: any) => {
      const created = await tx.transferLookupTable.create({
        data: {
          name: input.name,
          description: input.description ?? null,
          createdById: userId
        }
      });

      // Create columns
      const columnMap = new Map<string, string>();
      for (let i = 0; i < input.columns.length; i++) {
        const col = await tx.transferLookupColumn.create({
          data: {
            tableId: created.id,
            name: input.columns[i],
            columnOrder: i
          }
        });
        columnMap.set(input.columns[i], col.id);
      }

      // Create rows + values
      if (input.rows) {
        for (let i = 0; i < input.rows.length; i++) {
          const rowInput = input.rows[i];
          const row = await tx.transferLookupRow.create({
            data: {
              tableId: created.id,
              businessUnit: rowInput.businessUnit ?? null,
              rangeFrom: rowInput.rangeFrom,
              rangeTo: rowInput.rangeTo,
              rowOrder: i
            }
          });

          // Create values for each column
          for (const [colName, value] of Object.entries(rowInput.values)) {
            const colId = columnMap.get(colName);
            if (!colId) continue; // skip unknown columns
            await tx.transferLookupValue.create({
              data: {
                rowId: row.id,
                columnId: colId,
                valueType: "CONSTANT",
                valueParam: value
              }
            });
          }
        }
      }

      return created;
    });

    // Return full table
    return this.get(table.id);
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async update(tableId: string, input: LookupTableUpdateInput) {
    const db = this.prisma as any;

    const existing = await db.transferLookupTable.findUnique({
      where: { id: tableId }
    });
    if (!existing) {
      throw new LookupServiceError("LOOKUP_TABLE_NOT_FOUND", "Lookup table not found.", 404);
    }

    await this.prisma.$transaction(async (tx: any) => {
      // Update metadata
      const updateData: Record<string, unknown> = {};
      if (input.name !== undefined) updateData.name = input.name;
      if (input.description !== undefined) updateData.description = input.description;

      if (Object.keys(updateData).length > 0) {
        await tx.transferLookupTable.update({
          where: { id: tableId },
          data: updateData
        });
      }

      // If columns provided, replace them (and all rows/values cascade)
      if (input.columns) {
        // Delete existing rows (cascades to values)
        await tx.transferLookupRow.deleteMany({ where: { tableId } });
        // Delete existing columns
        await tx.transferLookupColumn.deleteMany({ where: { tableId } });

        // Create new columns
        const columnMap = new Map<string, string>();
        for (let i = 0; i < input.columns.length; i++) {
          const col = await tx.transferLookupColumn.create({
            data: {
              tableId,
              name: input.columns[i],
              columnOrder: i
            }
          });
          columnMap.set(input.columns[i], col.id);
        }

        // Create new rows if provided
        if (input.rows) {
          for (let i = 0; i < input.rows.length; i++) {
            const rowInput = input.rows[i];
            const row = await tx.transferLookupRow.create({
              data: {
                tableId,
                businessUnit: rowInput.businessUnit ?? null,
                rangeFrom: rowInput.rangeFrom,
                rangeTo: rowInput.rangeTo,
                rowOrder: i
              }
            });

            for (const [colName, value] of Object.entries(rowInput.values)) {
              const colId = columnMap.get(colName);
              if (!colId) continue;
              await tx.transferLookupValue.create({
                data: {
                  rowId: row.id,
                  columnId: colId,
                  valueType: "CONSTANT",
                  valueParam: value
                }
              });
            }
          }
        }
      } else if (input.rows) {
        // Rows only (columns unchanged) — replace rows keeping existing columns
        const columns = await tx.transferLookupColumn.findMany({
          where: { tableId },
          orderBy: { columnOrder: "asc" }
        });
        const columnMap = new Map<string, string>(columns.map((c: any) => [c.name, c.id]));

        await tx.transferLookupRow.deleteMany({ where: { tableId } });

        for (let i = 0; i < input.rows.length; i++) {
          const rowInput = input.rows[i];
          const row = await tx.transferLookupRow.create({
            data: {
              tableId,
              businessUnit: rowInput.businessUnit ?? null,
              rangeFrom: rowInput.rangeFrom,
              rangeTo: rowInput.rangeTo,
              rowOrder: i
            }
          });

          for (const [colName, value] of Object.entries(rowInput.values)) {
            const colId = columnMap.get(colName);
            if (!colId) continue;
            await tx.transferLookupValue.create({
              data: {
                rowId: row.id,
                columnId: colId,
                valueType: "CONSTANT",
                valueParam: value
              }
            });
          }
        }
      }
    });

    return this.get(tableId);
  }
}
