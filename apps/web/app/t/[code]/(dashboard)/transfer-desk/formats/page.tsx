"use client";

/**
 * Transfer Desk — Format list page
 *
 * Table of all TransferFormat definitions with classification filter.
 * Links to format detail pages and the creation wizard.
 */

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApiContext } from "../../../../../../components/use-api-context";
import { useUserRole } from "../../../../../../components/use-user-role";
import { useTenantHref } from "../../../../../../hooks/use-tenant-router";
import {
  listTransferFormats,
  type TransferFormatSummary,
  type FormatClassification
} from "../../../../../../lib/gl-api";
import { Card, CardContent } from "../../../../../../components/ui/card";
import { Badge } from "../../../../../../components/ui/badge";
import { Button } from "../../../../../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../../../components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../../../../../components/ui/table";
import { ArrowLeft, Plus, FileText, CheckCircle2, XCircle, Lock } from "lucide-react";

const CLASSIFICATION_LABELS: Record<FormatClassification, { label: string; badge: string }> = {
  DELIMITED: { label: "Delimited", badge: "bg-blue-50 text-blue-700 border-blue-200" },
  SINGLE_FIXED: {
    label: "Fixed Width",
    badge: "bg-purple-50 text-purple-700 border-purple-200"
  },
  MULTIPLE_FIXED: {
    label: "Multi Fixed",
    badge: "bg-violet-50 text-violet-700 border-violet-200"
  },
  OTHER_FLAT: { label: "Other Flat", badge: "bg-gray-50 text-gray-700 border-gray-200" },
  USER_XML: { label: "User XML", badge: "bg-orange-50 text-orange-700 border-orange-200" },
  SIMPLE_XML: { label: "Simple XML", badge: "bg-green-50 text-green-700 border-green-200" }
};

export default function FormatsListPage() {
  const apiCtx = useApiContext();
  const { canTransferDeskDesigner } = useUserRole();
  const href = useTenantHref();

  const [classFilter, setClassFilter] = useState<string>("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["transfer-formats", classFilter === "all" ? undefined : classFilter],
    queryFn: () =>
      listTransferFormats(apiCtx!, {
        classification: classFilter === "all" ? undefined : (classFilter as FormatClassification)
      })
  });

  const formats = data?.data ?? [];

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
            <h1 className="text-2xl font-bold tracking-tight">Format Definitions</h1>
            <p className="text-sm text-muted-foreground">
              Manage file format definitions for import and export profiles
            </p>
          </div>
        </div>
        {canTransferDeskDesigner && (
          <Link href={href("/transfer-desk/formats/new")}>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Format
            </Button>
          </Link>
        )}
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <Select value={classFilter} onValueChange={setClassFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All classifications" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All classifications</SelectItem>
            <SelectItem value="DELIMITED">Delimited</SelectItem>
            <SelectItem value="SINGLE_FIXED">Fixed Width</SelectItem>
            <SelectItem value="SIMPLE_XML">Simple XML</SelectItem>
            <SelectItem value="MULTIPLE_FIXED">Multi Fixed</SelectItem>
            <SelectItem value="OTHER_FLAT">Other Flat</SelectItem>
            <SelectItem value="USER_XML">User XML</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {formats.length} format{formats.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              Loading formats...
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-12 text-red-600">
              Failed to load formats
            </div>
          ) : formats.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <FileText className="mb-3 h-10 w-10 opacity-40" />
              <p>No format definitions found</p>
              {canTransferDeskDesigner && (
                <Link href={href("/transfer-desk/formats/new")} className="mt-2">
                  <Button variant="outline" size="sm">
                    <Plus className="mr-2 h-3 w-3" />
                    Create your first format
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Classification</TableHead>
                  <TableHead className="text-center">System</TableHead>
                  <TableHead className="text-center">Valid</TableHead>
                  <TableHead className="text-center">Profiles</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {formats.map((fmt: TransferFormatSummary) => {
                  const cls =
                    CLASSIFICATION_LABELS[fmt.classification] ?? CLASSIFICATION_LABELS.DELIMITED;
                  const profileCount =
                    (fmt._count?.sourceProfiles ?? 0) + (fmt._count?.targetProfiles ?? 0);

                  return (
                    <TableRow key={fmt.id} className="cursor-pointer hover:bg-muted/50">
                      <TableCell>
                        <Link
                          href={href(`/transfer-desk/formats/${fmt.id}`)}
                          className="font-medium text-foreground hover:underline"
                        >
                          {fmt.name}
                        </Link>
                        {fmt.description && (
                          <p className="text-xs text-muted-foreground line-clamp-1">
                            {fmt.description}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cls.badge}>
                          {cls.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {fmt.isSystem && <Lock className="mx-auto h-4 w-4 text-muted-foreground" />}
                      </TableCell>
                      <TableCell className="text-center">
                        {fmt.isValid ? (
                          <CheckCircle2 className="mx-auto h-4 w-4 text-green-600" />
                        ) : (
                          <XCircle className="mx-auto h-4 w-4 text-red-500" />
                        )}
                      </TableCell>
                      <TableCell className="text-center text-sm text-muted-foreground">
                        {profileCount}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(fmt.updatedAt).toLocaleDateString()}
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
