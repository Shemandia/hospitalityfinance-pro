"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useApiContext } from "../../../../components/use-api-context";
import { getAuditEvents } from "../../../../lib/gl-api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "../../../../components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../components/ui/select";
import { Input } from "../../../../components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../../../components/ui/table";
import { Badge } from "../../../../components/ui/badge";
import { useUserRole } from "../../../../components/use-user-role";

type AuditEvent = {
  id: string;
  eventType: string;
  resourceType: string;
  resourceId: string;
  userId?: string | null;
  createdAt: string;
  beforeState?: unknown;
  afterState?: unknown;
};

/** Redact sensitive fields from audit state snapshots before display. */
function redactState(state: unknown): unknown {
  if (!state || typeof state !== "object") return state;
  const SENSITIVE_KEYS = new Set([
    "bankAccount",
    "bankRoutingNumber",
    "iban",
    "swiftBic",
    "taxId",
    "password",
    "secret",
    "token",
    "accessToken",
    "email",
    "phone"
  ]);
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key)) {
      redacted[key] = "***REDACTED***";
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

export default function AuditPage() {
  const apiContext = useApiContext();
  const { canAdmin } = useUserRole();

  if (!canAdmin) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            You do not have permission to view the audit log. Contact your administrator.
          </p>
        </CardContent>
      </Card>
    );
  }
  const [resourceType, setResourceType] = useState("journal");
  const [resourceId, setResourceId] = useState("");

  const query = useQuery({
    queryKey: ["audit", apiContext?.tenantSlug, apiContext?.entityId, resourceType, resourceId],
    queryFn: async () => {
      if (!apiContext || !resourceId.trim()) {
        return [];
      }
      const response = await getAuditEvents(apiContext, {
        resourceType,
        resourceId: resourceId.trim(),
        limit: 200
      });
      return (response.data as unknown as AuditEvent[]) ?? [];
    },
    enabled: Boolean(apiContext && resourceId.trim().length > 0)
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit Log Viewer</CardTitle>
        <CardDescription>
          Query immutable audit events by resource type and resource ID.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2.5 mb-4">
          <Select value={resourceType} onValueChange={setResourceType}>
            <SelectTrigger className="w-45">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="journal">journal</SelectItem>
              <SelectItem value="journalline">journalline</SelectItem>
              <SelectItem value="account">account</SelectItem>
              <SelectItem value="apinvoice">apinvoice</SelectItem>
              <SelectItem value="arinvoice">arinvoice</SelectItem>
              <SelectItem value="appayment">appayment</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder="Resource ID"
            value={resourceId}
            onChange={(event) => setResourceId(event.target.value)}
            className="min-w-80"
          />
        </div>

        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading audit events...</p>
        ) : null}
        {query.isError ? (
          <p className="text-sm text-destructive">{(query.error as Error).message}</p>
        ) : null}

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Before</TableHead>
                <TableHead>After</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(query.data ?? []).map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="whitespace-nowrap">
                    {new Date(event.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{event.eventType}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{event.userId ?? "-"}</TableCell>
                  <TableCell>
                    <pre className="m-0 whitespace-pre-wrap text-xs max-w-xs overflow-auto">
                      {event.beforeState
                        ? JSON.stringify(redactState(event.beforeState), null, 2)
                        : "-"}
                    </pre>
                  </TableCell>
                  <TableCell>
                    <pre className="m-0 whitespace-pre-wrap text-xs max-w-xs overflow-auto">
                      {event.afterState
                        ? JSON.stringify(redactState(event.afterState), null, 2)
                        : "-"}
                    </pre>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
