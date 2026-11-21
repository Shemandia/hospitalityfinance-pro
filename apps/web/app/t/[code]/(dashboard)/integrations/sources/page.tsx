"use client";

/**
 * Integrations — Sources: the systems that send documents to the ledger
 * (a PMS, a POS, a materials system). The codes are the tenant's; every
 * ledger import profile names one, and every journal it posts carries it.
 * A code never changes once in use; a source is deactivated, not deleted.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Plug, Plus } from "lucide-react";
import { useApiContext } from "../../../../../../components/use-api-context";
import { usePermissions } from "../../../../../../components/use-permissions";
import { QueryError } from "../../../../../../components/query-error";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../../../components/ui/card";
import { Badge } from "../../../../../../components/ui/badge";
import { Button } from "../../../../../../components/ui/button";
import {
  createSourceSystem,
  listSourceSystems,
  updateSourceSystem,
  type SourceSystem
} from "../../../../../../lib/gl-api";

const CODE = /^[A-Z0-9][A-Z0-9_-]{0,19}$/;

export default function IntegrationSourcesPage() {
  const api = useApiContext();
  const role = usePermissions();
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const sources = useQuery({
    queryKey: ["integrations-source-systems", api?.tenantSlug],
    queryFn: async () => (await listSourceSystems(api!)).data ?? [],
    enabled: Boolean(api) && role.canIntegrationUser
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["integrations-source-systems"] });

  const create = useMutation({
    mutationFn: () => createSourceSystem(api!, { code: code.trim(), name: name.trim() }),
    onSuccess: () => {
      setCode("");
      setName("");
      setError(null);
      refresh();
    },
    onError: (e: Error) => setError(e.message)
  });

  const toggle = useMutation({
    mutationFn: (source: SourceSystem) =>
      updateSourceSystem(api!, source.code, { isActive: !source.isActive }),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message)
  });

  if (!role.canIntegrationUser) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 p-6 text-center">
        <Lock className="h-10 w-10 text-slate-300" />
        <h2 className="text-lg font-semibold text-slate-700">Access required</h2>
      </div>
    );
  }

  const codeOk = CODE.test(code.trim());

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800 flex items-center gap-2">
          <Plug className="h-6 w-6 text-emerald-600" aria-hidden /> Sources
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          The systems that send documents to the ledger. Each ledger import profile names one, and
          every journal it posts carries its code, so the same document never posts twice.
        </p>
      </div>

      {role.canIntegrationAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add a source</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col sm:flex-row gap-3 sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                if (codeOk && name.trim()) create.mutate();
              }}
            >
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">Code</span>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="OPERA"
                  maxLength={20}
                  aria-invalid={code !== "" && !codeOk}
                  className="rounded-lg border border-slate-200 px-3 py-2 font-mono uppercase"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm flex-1">
                <span className="font-medium text-slate-700">Name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Opera PMS night audit"
                  maxLength={100}
                  className="rounded-lg border border-slate-200 px-3 py-2"
                />
              </label>
              <Button type="submit" disabled={!codeOk || !name.trim() || create.isPending}>
                <Plus className="h-4 w-4" aria-hidden /> Add
              </Button>
            </form>
            {code !== "" && !codeOk && (
              <p className="text-xs text-amber-700 mt-2">
                Capital letters, digits, - or _, starting with a letter or digit; at most 20.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <Card>
        <CardContent className="p-0">
          {sources.isError ? (
            <QueryError
              message={(sources.error as Error).message}
              onRetry={() => sources.refetch()}
            />
          ) : (sources.data ?? []).length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              {sources.isLoading ? "Loading…" : "No sources yet."}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500 border-b">
                <tr>
                  <th className="px-4 py-2 font-medium">Code</th>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  {role.canIntegrationAdmin && <th className="px-4 py-2" />}
                </tr>
              </thead>
              <tbody>
                {(sources.data ?? []).map((s) => (
                  <tr key={s.code} className="border-b last:border-0">
                    <td className="px-4 py-2 font-mono">{s.code}</td>
                    <td className="px-4 py-2">{s.name}</td>
                    <td className="px-4 py-2">
                      <Badge variant={s.isActive ? "default" : "secondary"}>
                        {s.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    {role.canIntegrationAdmin && (
                      <td className="px-4 py-2 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={toggle.isPending}
                          onClick={() => toggle.mutate(s)}
                        >
                          {s.isActive ? "Deactivate" : "Activate"}
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
