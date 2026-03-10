"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useApiContext } from "../../../components/use-api-context";
import { getAuditEvents } from "../../../lib/gl-api";

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

export default function AuditPage() {
  const apiContext = useApiContext();
  const [resourceType, setResourceType] = useState("journal");
  const [resourceId, setResourceId] = useState("");

  const query = useQuery({
    queryKey: ["audit", apiContext?.entityId, resourceType, resourceId],
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
    <section style={{ background: "#fff", borderRadius: "12px", padding: "1rem", boxShadow: "0 10px 24px rgba(15,45,94,.07)" }}>
      <h2 style={{ marginTop: 0, color: "#0f2d5e" }}>Audit Log Viewer</h2>
      <p style={{ marginTop: 0, color: "#475569" }}>
        Query immutable audit events by resource type and resource ID.
      </p>

      <div style={{ display: "flex", gap: "0.6rem", marginBottom: "0.8rem" }}>
        <select value={resourceType} onChange={(event) => setResourceType(event.target.value)}>
          <option value="journal">journal</option>
          <option value="journalline">journalline</option>
          <option value="account">account</option>
          <option value="apinvoice">apinvoice</option>
          <option value="arinvoice">arinvoice</option>
          <option value="appayment">appayment</option>
        </select>
        <input
          placeholder="Resource ID"
          value={resourceId}
          onChange={(event) => setResourceId(event.target.value)}
          style={{ minWidth: "320px" }}
        />
      </div>

      {query.isLoading ? <p>Loading audit events...</p> : null}
      {query.isError ? <p style={{ color: "#b91c1c" }}>{(query.error as Error).message}</p> : null}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #e2e8f0", padding: "0.5rem" }}>When</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #e2e8f0", padding: "0.5rem" }}>Event</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #e2e8f0", padding: "0.5rem" }}>User</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #e2e8f0", padding: "0.5rem" }}>Before</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #e2e8f0", padding: "0.5rem" }}>After</th>
            </tr>
          </thead>
          <tbody>
            {(query.data ?? []).map((event) => (
              <tr key={event.id}>
                <td style={{ borderBottom: "1px solid #f1f5f9", padding: "0.5rem" }}>
                  {new Date(event.createdAt).toLocaleString()}
                </td>
                <td style={{ borderBottom: "1px solid #f1f5f9", padding: "0.5rem" }}>{event.eventType}</td>
                <td style={{ borderBottom: "1px solid #f1f5f9", padding: "0.5rem" }}>{event.userId ?? "-"}</td>
                <td style={{ borderBottom: "1px solid #f1f5f9", padding: "0.5rem" }}>
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                    {event.beforeState ? JSON.stringify(event.beforeState, null, 2) : "-"}
                  </pre>
                </td>
                <td style={{ borderBottom: "1px solid #f1f5f9", padding: "0.5rem" }}>
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                    {event.afterState ? JSON.stringify(event.afterState, null, 2) : "-"}
                  </pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
