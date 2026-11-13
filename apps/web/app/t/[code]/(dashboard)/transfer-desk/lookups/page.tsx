"use client";

/**
 * Transfer Desk — Lookup Table list page
 *
 * Table of all TransferLookupTable definitions with column/row counts.
 */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useApiContext } from "../../../../../../components/use-api-context";
import { usePermissions } from "../../../../../../components/use-permissions";
import { useTenantHref } from "../../../../../../hooks/use-tenant-router";
import {
  listTransferLookupTables,
  type TransferLookupTableSummary
} from "../../../../../../lib/gl-api";
import { Card, CardContent } from "../../../../../../components/ui/card";
import { Badge } from "../../../../../../components/ui/badge";
import { Button } from "../../../../../../components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../../../../../components/ui/table";
import { ArrowLeft, Plus, Database } from "lucide-react";

export default function LookupsListPage() {
  const apiCtx = useApiContext();
  const { canTransferDeskDesigner } = usePermissions();
  const href = useTenantHref();

  const { data, isLoading, error } = useQuery({
    queryKey: ["transfer-lookups"],
    queryFn: () => listTransferLookupTables(apiCtx!)
  });

  const tables: TransferLookupTableSummary[] = data?.data ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href={href("/transfer-desk")}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Lookup Tables</h1>
            <p className="text-sm text-muted-foreground">
              Range-based value substitution tables for transformation rules
            </p>
          </div>
        </div>
        {canTransferDeskDesigner && (
          <Link href={href("/transfer-desk/lookups/new")}>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Lookup Table
            </Button>
          </Link>
        )}
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              Loading lookup tables...
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-12 text-red-600">
              Failed to load lookup tables
            </div>
          ) : tables.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Database className="mb-3 h-10 w-10 opacity-40" />
              <p>No lookup tables defined yet</p>
              {canTransferDeskDesigner && (
                <Link href={href("/transfer-desk/lookups/new")} className="mt-2">
                  <Button variant="outline" size="sm">
                    <Plus className="mr-2 h-3 w-3" />
                    Create your first lookup table
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-center">Columns</TableHead>
                  <TableHead className="text-center">Rows</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tables.map((t) => (
                  <TableRow key={t.id} className="cursor-pointer hover:bg-muted/50">
                    <TableCell>
                      <Link
                        href={href(`/transfer-desk/lookups/${t.id}`)}
                        className="font-medium text-foreground hover:underline"
                      >
                        {t.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {t.description || "—"}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline">{t._count?.columns ?? 0}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline">{t._count?.rows ?? 0}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(t.updatedAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
