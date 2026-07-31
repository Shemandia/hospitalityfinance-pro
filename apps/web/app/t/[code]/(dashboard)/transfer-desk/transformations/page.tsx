"use client";

/**
 * Transfer Desk — Transformation list page
 *
 * Table of all TransferTransformation definitions.
 * Links to transformation detail/mapper pages and the creation wizard.
 */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useApiContext } from "../../../../../../components/use-api-context";
import { useUserRole } from "../../../../../../components/use-user-role";
import { useTenantHref } from "../../../../../../hooks/use-tenant-router";
import {
  listTransferTransformations,
  type TransferTransformationSummary
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
import { ArrowLeft, Plus, Workflow, CheckCircle2, XCircle, Lock, ArrowRight } from "lucide-react";

export default function TransformationsListPage() {
  const apiCtx = useApiContext();
  const { canTransferDeskDesigner } = useUserRole();
  const href = useTenantHref();

  const { data, isLoading, error } = useQuery({
    queryKey: ["transfer-transformations"],
    queryFn: () => listTransferTransformations(apiCtx!)
  });

  const transformations = data?.data ?? [];

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
            <h1 className="text-2xl font-bold tracking-tight">Transformation Definitions</h1>
            <p className="text-sm text-muted-foreground">
              TML mapping definitions for transforming data between formats and components
            </p>
          </div>
        </div>
        {canTransferDeskDesigner && (
          <Link href={href("/transfer-desk/transformations/new")}>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Transformation
            </Button>
          </Link>
        )}
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              Loading transformations...
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-12 text-red-600">
              Failed to load transformations
            </div>
          ) : transformations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Workflow className="mb-3 h-10 w-10 opacity-40" />
              <p>No transformation definitions found</p>
              {canTransferDeskDesigner && (
                <Link href={href("/transfer-desk/transformations/new")} className="mt-2">
                  <Button variant="outline" size="sm">
                    <Plus className="mr-2 h-3 w-3" />
                    Create your first transformation
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-center">
                    <ArrowRight className="mx-auto h-4 w-4" />
                  </TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead className="text-center">System</TableHead>
                  <TableHead className="text-center">Valid</TableHead>
                  <TableHead className="text-center">Profiles</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transformations.map((t: TransferTransformationSummary) => {
                  const profileCount = t._count?.profiles ?? 0;
                  const sourceName = t.sourceFormat?.name ?? t.sourceComponent ?? "—";
                  const targetName = t.targetFormat?.name ?? t.targetComponent ?? "—";

                  return (
                    <TableRow key={t.id} className="cursor-pointer hover:bg-muted/50">
                      <TableCell>
                        <Link
                          href={href(`/transfer-desk/transformations/${t.id}`)}
                          className="font-medium text-foreground hover:underline"
                        >
                          {t.name}
                        </Link>
                        {t.description && (
                          <p className="text-xs text-muted-foreground line-clamp-1">
                            {t.description}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {t.sourceFormat ? (
                          <Badge
                            variant="outline"
                            className="bg-blue-50 text-blue-700 border-blue-200"
                          >
                            {sourceName}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">{sourceName}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <ArrowRight className="mx-auto h-3.5 w-3.5 text-muted-foreground" />
                      </TableCell>
                      <TableCell className="text-sm">
                        {t.targetFormat ? (
                          <Badge
                            variant="outline"
                            className="bg-green-50 text-green-700 border-green-200"
                          >
                            {targetName}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">{targetName}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {t.isSystem && <Lock className="mx-auto h-4 w-4 text-muted-foreground" />}
                      </TableCell>
                      <TableCell className="text-center">
                        {t.isValid ? (
                          <CheckCircle2 className="mx-auto h-4 w-4 text-green-600" />
                        ) : (
                          <XCircle className="mx-auto h-4 w-4 text-red-500" />
                        )}
                      </TableCell>
                      <TableCell className="text-center text-sm text-muted-foreground">
                        {profileCount}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(t.updatedAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
