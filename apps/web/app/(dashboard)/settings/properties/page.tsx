"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiContext } from "../../../../components/use-api-context";
import {
  getEntities,
  createEntity,
  updateEntity,
  deleteEntity,
  type EntitySummaryItem,
  type EntityPayload
} from "../../../../lib/gl-api";
import {
  Building2,
  Plus,
  Pencil,
  Trash2,
  X,
  Check,
  ChevronRight,
  Globe,
  MapPin,
  Users,
  FolderTree
} from "lucide-react";

type FormState = EntityPayload & { id?: string };

const EMPTY_FORM: FormState = {
  name: "",
  type: "PROPERTY",
  parentId: null,
  functionalCurrency: "USD",
  reportingCurrency: "USD",
  timezone: "UTC",
  countryCode: "",
  address: "",
  city: "",
  postalCode: ""
};

const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Qatar",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Africa/Nairobi",
  "Africa/Dar_es_Salaam"
];

const CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "AED",
  "QAR",
  "TZS",
  "KES",
  "SGD",
  "JPY",
  "AUD",
  "CHF",
  "CAD"
];

export default function PropertiesPage() {
  const api = useApiContext();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<FormState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data: entitiesRes, isLoading } = useQuery({
    queryKey: ["entities"],
    queryFn: () => getEntities(api!),
    enabled: !!api
  });

  const entities: EntitySummaryItem[] = entitiesRes?.data ?? [];
  const groups = entities.filter((e) => e.type === "GROUP");
  const properties = entities.filter((e) => e.type === "PROPERTY");

  const createMut = useMutation({
    mutationFn: (payload: EntityPayload) => createEntity(api!, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entities"] });
      setEditing(null);
    }
  });

  const updateMut = useMutation({
    mutationFn: ({ id, ...payload }: EntityPayload & { id: string }) =>
      updateEntity(api!, id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entities"] });
      setEditing(null);
    }
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteEntity(api!, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entities"] });
      setConfirmDelete(null);
    }
  });

  const handleSave = () => {
    if (!editing) return;
    const { id, ...payload } = editing;
    if (id) {
      updateMut.mutate({ id, ...payload });
    } else {
      createMut.mutate(payload);
    }
  };

  const openEdit = (entity: EntitySummaryItem) => {
    setEditing({
      id: entity.id,
      name: entity.name,
      type: entity.type,
      parentId: entity.parentId,
      functionalCurrency: entity.functionalCurrency,
      reportingCurrency: entity.reportingCurrency,
      timezone: entity.timezone,
      countryCode: entity.countryCode,
      address: entity.address ?? "",
      city: entity.city ?? "",
      postalCode: entity.postalCode ?? ""
    });
  };

  if (!api) return <p className="text-muted-foreground p-8">Loading session…</p>;

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Properties & Groups</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage hotel properties and corporate group entities
          </p>
        </div>
        <button
          onClick={() => setEditing({ ...EMPTY_FORM })}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" /> New Entity
        </button>
      </div>

      {/* Form Panel */}
      {editing && (
        <div className="border border-border rounded-lg bg-white p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{editing.id ? "Edit Entity" : "New Entity"}</h2>
            <button
              onClick={() => setEditing(null)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Name */}
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Name</label>
              <input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="e.g. Grand Hotel Dubai"
                className="w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Type */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Type</label>
              <select
                value={editing.type}
                onChange={(e) =>
                  setEditing({ ...editing, type: e.target.value as "GROUP" | "PROPERTY" })
                }
                className="w-full rounded-md border border-border px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="PROPERTY">Property</option>
                <option value="GROUP">Group</option>
              </select>
            </div>

            {/* Parent */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Parent Group
              </label>
              <select
                value={editing.parentId ?? ""}
                onChange={(e) => setEditing({ ...editing, parentId: e.target.value || null })}
                className="w-full rounded-md border border-border px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">None (top-level)</option>
                {groups
                  .filter((g) => g.id !== editing.id)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
              </select>
            </div>

            {/* Country */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Country Code
              </label>
              <input
                value={editing.countryCode}
                onChange={(e) =>
                  setEditing({ ...editing, countryCode: e.target.value.toUpperCase().slice(0, 2) })
                }
                placeholder="AE"
                maxLength={2}
                className="w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Timezone */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Timezone
              </label>
              <select
                value={editing.timezone}
                onChange={(e) => setEditing({ ...editing, timezone: e.target.value })}
                className="w-full rounded-md border border-border px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>

            {/* Functional Currency */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Functional Currency
              </label>
              <select
                value={editing.functionalCurrency}
                onChange={(e) => setEditing({ ...editing, functionalCurrency: e.target.value })}
                className="w-full rounded-md border border-border px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* Reporting Currency */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Reporting Currency
              </label>
              <select
                value={editing.reportingCurrency}
                onChange={(e) => setEditing({ ...editing, reportingCurrency: e.target.value })}
                className="w-full rounded-md border border-border px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* City */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">City</label>
              <input
                value={editing.city ?? ""}
                onChange={(e) => setEditing({ ...editing, city: e.target.value })}
                placeholder="Dubai"
                className="w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Address */}
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Address
              </label>
              <input
                value={editing.address ?? ""}
                onChange={(e) => setEditing({ ...editing, address: e.target.value })}
                placeholder="123 Marina Walk"
                className="w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          {/* Save / Cancel */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setEditing(null)}
              className="px-4 py-2 text-sm rounded-md border border-border hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={
                !editing.name || !editing.countryCode || createMut.isPending || updateMut.isPending
              }
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <Check className="h-4 w-4" />
              {editing.id ? "Save Changes" : "Create Entity"}
            </button>
          </div>

          {(createMut.isError || updateMut.isError) && (
            <p className="text-sm text-destructive">
              {(createMut.error ?? updateMut.error)?.message}
            </p>
          )}
        </div>
      )}

      {/* Entity List */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading entities…</div>
      ) : entities.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-lg">
          <Building2 className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground">
            No entities yet. Create your first group or property.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Groups first, then standalone properties */}
          {groups.map((group) => {
            const children = properties.filter((p) => p.parentId === group.id);
            return (
              <div
                key={group.id}
                className="border border-border rounded-lg bg-white overflow-hidden"
              >
                {/* Group header */}
                <div className="flex items-center gap-3 px-4 py-3 bg-muted/30">
                  <FolderTree className="h-5 w-5 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm">{group.name}</p>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium uppercase">
                        Group
                      </span>
                      {!group.isActive && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive font-medium">
                          Inactive
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      <span className="flex items-center gap-1">
                        <Globe className="h-3 w-3" />
                        {group.functionalCurrency}
                      </span>
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {group.countryCode}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {group._count?.users ?? 0} users
                      </span>
                      <span>{children.length} properties</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEdit(group)}
                      className="p-1.5 rounded hover:bg-muted transition-colors"
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                    {confirmDelete === group.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => deleteMut.mutate(group.id)}
                          className="p-1.5 rounded bg-destructive text-white text-xs hover:bg-destructive/90"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="p-1.5 rounded hover:bg-muted text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(group.id)}
                        className="p-1.5 rounded hover:bg-muted transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Child properties */}
                {children.length > 0 && (
                  <div className="divide-y divide-border">
                    {children.map((prop) => (
                      <EntityRow
                        key={prop.id}
                        entity={prop}
                        indent
                        onEdit={() => openEdit(prop)}
                        onDelete={() =>
                          confirmDelete === prop.id
                            ? deleteMut.mutate(prop.id)
                            : setConfirmDelete(prop.id)
                        }
                        confirmDelete={confirmDelete === prop.id}
                        onCancelDelete={() => setConfirmDelete(null)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Standalone properties (no parent) */}
          {properties
            .filter((p) => !p.parentId)
            .map((prop) => (
              <div
                key={prop.id}
                className="border border-border rounded-lg bg-white overflow-hidden"
              >
                <EntityRow
                  entity={prop}
                  onEdit={() => openEdit(prop)}
                  onDelete={() =>
                    confirmDelete === prop.id
                      ? deleteMut.mutate(prop.id)
                      : setConfirmDelete(prop.id)
                  }
                  confirmDelete={confirmDelete === prop.id}
                  onCancelDelete={() => setConfirmDelete(null)}
                />
              </div>
            ))}
        </div>
      )}

      {deleteMut.isError && <p className="text-sm text-destructive">{deleteMut.error?.message}</p>}

      {/* Info */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 space-y-1">
        <p className="font-medium">How properties work</p>
        <ul className="list-disc list-inside text-xs space-y-0.5 text-blue-700">
          <li>
            <strong>Groups</strong> are corporate entities that own multiple properties (used for
            consolidation)
          </li>
          <li>
            <strong>Properties</strong> are individual hotels, resorts, or restaurant outlets
          </li>
          <li>Each property has its own chart of accounts, journals, budgets, and reporting</li>
          <li>Users are assigned to entities with a role (Admin, Controller, Viewer)</li>
          <li>Use the entity switcher in the sidebar to switch between properties</li>
        </ul>
      </div>
    </div>
  );
}

function EntityRow({
  entity,
  indent,
  onEdit,
  onDelete,
  confirmDelete,
  onCancelDelete
}: {
  entity: EntitySummaryItem;
  indent?: boolean;
  onEdit: () => void;
  onDelete: () => void;
  confirmDelete: boolean;
  onCancelDelete: () => void;
}) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${indent ? "pl-10" : ""}`}>
      {indent && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 -ml-4" />}
      <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium text-sm">{entity.name}</p>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-medium uppercase">
            Property
          </span>
          {!entity.isActive && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive font-medium">
              Inactive
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
          <span className="flex items-center gap-1">
            <Globe className="h-3 w-3" />
            {entity.functionalCurrency}
          </span>
          <span className="flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            {entity.countryCode} {entity.city && `· ${entity.city}`}
          </span>
          <span>{entity.timezone}</span>
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {entity._count?.users ?? 0} users
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={onEdit}
          className="p-1.5 rounded hover:bg-muted transition-colors"
          title="Edit"
        >
          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        {confirmDelete ? (
          <div className="flex items-center gap-1">
            <button
              onClick={onDelete}
              className="p-1.5 rounded bg-destructive text-white text-xs hover:bg-destructive/90"
            >
              Confirm
            </button>
            <button onClick={onCancelDelete} className="p-1.5 rounded hover:bg-muted text-xs">
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={onDelete}
            className="p-1.5 rounded hover:bg-muted transition-colors"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}
      </div>
    </div>
  );
}
