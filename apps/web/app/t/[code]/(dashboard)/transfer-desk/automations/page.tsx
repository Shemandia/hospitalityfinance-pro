"use client";

/**
 * Transfer Desk — Automation list page
 *
 * Table of all TransferAutomation definitions with step/schedule counts.
 * Links to automation detail pages and the creation wizard.
 */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useApiContext } from "../../../../../../components/use-api-context";
import { usePermissions } from "../../../../../../components/use-permissions";
import { useTenantHref } from "../../../../../../hooks/use-tenant-router";
import {
  listTransferAutomations,
  type TransferAutomationSummary
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
import {
  ArrowLeft,
  Plus,
  CalendarClock,
  CheckCircle2,
  XCircle,
  PlayCircle,
  Clock
} from "lucide-react";

export default function AutomationsListPage() {
  const apiCtx = useApiContext();
  const { canTransferDeskDesigner } = usePermissions();
  const href = useTenantHref();

  const { data, isLoading, error } = useQuery({
    queryKey: ["transfer-automations"],
    queryFn: () => listTransferAutomations(apiCtx!)
  });

  const automations: TransferAutomationSummary[] = data?.data ?? [];

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
            <h1 className="text-2xl font-bold tracking-tight">Automations</h1>
            <p className="text-sm text-muted-foreground">
              Scheduled multi-profile pipelines for automated data transfers
            </p>
          </div>
        </div>
        {canTransferDeskDesigner && (
          <Link href={href("/transfer-desk/automations/new")}>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Automation
            </Button>
          </Link>
        )}
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              Loading automations...
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-12 text-red-600">
              Failed to load automations
            </div>
          ) : automations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <CalendarClock className="mb-3 h-10 w-10 opacity-40" />
              <p>No automations defined yet</p>
              {canTransferDeskDesigner && (
                <Link href={href("/transfer-desk/automations/new")} className="mt-2">
                  <Button variant="outline" size="sm">
                    <Plus className="mr-2 h-3 w-3" />
                    Create your first automation
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-center">Steps</TableHead>
                  <TableHead className="text-center">Schedules</TableHead>
                  <TableHead className="text-center">Enabled</TableHead>
                  <TableHead className="text-center">Executions</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {automations.map((a) => {
                  const stepCount = a._count?.steps ?? a.steps?.length ?? 0;
                  const scheduleCount = a._count?.schedules ?? a.schedules?.length ?? 0;
                  const executionCount = a._count?.executions ?? 0;
                  const hasActiveSchedule = a.schedules?.some((s) => s.isActive);

                  return (
                    <TableRow key={a.id} className="cursor-pointer hover:bg-muted/50">
                      <TableCell>
                        <Link
                          href={href(`/transfer-desk/automations/${a.id}`)}
                          className="font-medium text-foreground hover:underline"
                        >
                          {a.name}
                        </Link>
                        {a.description && (
                          <p className="text-xs text-muted-foreground line-clamp-1">
                            {a.description}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-center text-sm">
                        <Badge variant="outline">{stepCount}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {scheduleCount > 0 ? (
                          <div className="flex items-center justify-center gap-1">
                            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-sm">{scheduleCount}</span>
                            {hasActiveSchedule && (
                              <span className="h-2 w-2 rounded-full bg-emerald-500" />
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {a.isEnabled ? (
                          <CheckCircle2 className="mx-auto h-4 w-4 text-green-600" />
                        ) : (
                          <XCircle className="mx-auto h-4 w-4 text-red-500" />
                        )}
                      </TableCell>
                      <TableCell className="text-center text-sm text-muted-foreground">
                        {executionCount}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(a.updatedAt).toLocaleDateString()}
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
