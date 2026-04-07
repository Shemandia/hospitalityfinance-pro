"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiContext } from "../../../../../components/use-api-context";
import {
  getEntities,
  createEntity,
  updateEntity,
  deleteEntity,
  type EntitySummaryItem,
  type EntityPayload
} from "../../../../../lib/gl-api";
import {
  Building2,
  Plus,
  Pencil,
  Trash2,
  X,
  Check,
  Globe,
  MapPin,
  Users,
  Search,
  SlidersHorizontal,
  CircleHelp,
  MoreVertical,
  Hotel
} from "lucide-react";
import { COUNTRIES, getCitiesForCountry } from "../../../../../lib/countries";

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
  const [search, setSearch] = useState("");
  const [showInfo, setShowInfo] = useState(true);

  const { data: entitiesRes, isLoading } = useQuery({
    queryKey: ["entities"],
    queryFn: () => getEntities(api!),
    enabled: !!api
  });

  const entities: EntitySummaryItem[] = entitiesRes?.data ?? [];
  const groups = entities.filter((e) => e.type === "GROUP" || (e.type as string) === "CORPORATE");
  const properties = entities.filter((e) => e.type === "PROPERTY");

  const filteredGroups = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.toLowerCase();
    return groups.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        g.code?.toLowerCase().includes(q) ||
        g.city?.toLowerCase().includes(q)
    );
  }, [groups, search]);

  const filteredProperties = useMemo(() => {
    if (!search.trim()) return properties;
    const q = search.toLowerCase();
    return properties.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.code?.toLowerCase().includes(q) ||
        p.city?.toLowerCase().includes(q)
    );
  }, [properties, search]);

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
    if (id) updateMut.mutate({ id, ...payload });
    else createMut.mutate(payload);
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

  if (!api) return <p className="text-slate-400 p-8">Loading session...</p>;

  return (
    <div className="p-6 lg:p-10 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Properties & Groups</h2>
          <p className="text-slate-500 mt-1">
            Manage your hotel portfolio and organizational structure.
          </p>
        </div>
        <button
          onClick={() => setEditing({ ...EMPTY_FORM })}
          className="bg-emerald-600 text-white px-6 py-3 rounded-2xl font-bold shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-all flex items-center gap-2"
        >
          <Plus className="h-5 w-5" />
          Create New
        </button>
      </div>

      {/* Search & Filters */}
      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 h-4.5 w-4.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search properties, cities, or groups..."
            className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all text-sm"
          />
        </div>
        <button className="px-6 py-3 bg-white border border-slate-200 rounded-2xl font-semibold text-slate-600 hover:bg-slate-50 transition-colors flex items-center gap-2 text-sm">
          <SlidersHorizontal className="h-4.5 w-4.5" />
          Filters
        </button>
      </div>

      {/* ── Form Panel ──────────────────────────────────────────────────── */}
      {editing && (
        <div className="bg-white border border-slate-100 rounded-4xl p-8 shadow-sm space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-800">
              {editing.id ? "Edit Entity" : "New Entity"}
            </h2>
            <button
              onClick={() => setEditing(null)}
              className="text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                Name
              </label>
              <input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="e.g. Grand Hotel Dubai"
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all"
              />
            </div>

            <div>
              <label
                htmlFor="form-type"
                className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider"
              >
                Type
              </label>
              <select
                id="form-type"
                value={editing.type}
                onChange={(e) =>
                  setEditing({ ...editing, type: e.target.value as "GROUP" | "PROPERTY" })
                }
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500"
              >
                <option value="PROPERTY">Property</option>
                <option value="GROUP">Group</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="form-parent"
                className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider"
              >
                Parent Group
              </label>
              <select
                id="form-parent"
                value={editing.parentId ?? ""}
                onChange={(e) => setEditing({ ...editing, parentId: e.target.value || null })}
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500"
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

            <div>
              <label
                htmlFor="form-country"
                className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider"
              >
                Country
              </label>
              <select
                id="form-country"
                value={editing.countryCode}
                onChange={(e) => setEditing({ ...editing, countryCode: e.target.value, city: "" })}
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500"
              >
                <option value="">Select country...</option>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="form-timezone"
                className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider"
              >
                Timezone
              </label>
              <select
                id="form-timezone"
                value={editing.timezone}
                onChange={(e) => setEditing({ ...editing, timezone: e.target.value })}
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="form-func-ccy"
                className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider"
              >
                Functional Currency
              </label>
              <select
                id="form-func-ccy"
                value={editing.functionalCurrency}
                onChange={(e) => setEditing({ ...editing, functionalCurrency: e.target.value })}
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="form-rpt-ccy"
                className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider"
              >
                Reporting Currency
              </label>
              <select
                id="form-rpt-ccy"
                value={editing.reportingCurrency}
                onChange={(e) => setEditing({ ...editing, reportingCurrency: e.target.value })}
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="form-city"
                className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider"
              >
                City
              </label>
              {(() => {
                const cities = getCitiesForCountry(editing.countryCode);
                return cities.length > 0 ? (
                  <select
                    id="form-city"
                    value={editing.city ?? ""}
                    onChange={(e) => setEditing({ ...editing, city: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500"
                  >
                    <option value="">Select city...</option>
                    {cities.map((city) => (
                      <option key={city} value={city}>
                        {city}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="form-city"
                    value={editing.city ?? ""}
                    onChange={(e) => setEditing({ ...editing, city: e.target.value })}
                    placeholder={editing.countryCode ? "Type city name" : "Select country first"}
                    className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500"
                  />
                );
              })()}
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                Address
              </label>
              <input
                value={editing.address ?? ""}
                onChange={(e) => setEditing({ ...editing, address: e.target.value })}
                placeholder="123 Marina Walk"
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={() => setEditing(null)}
              className="px-6 py-2.5 text-sm font-semibold rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={
                !editing.name || !editing.countryCode || createMut.isPending || updateMut.isPending
              }
              className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-bold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-all shadow-lg shadow-emerald-100"
            >
              <Check className="h-4 w-4" />
              {editing.id ? "Save Changes" : "Create Entity"}
            </button>
          </div>

          {(createMut.isError || updateMut.isError) && (
            <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">
              {(createMut.error ?? updateMut.error)?.message}
            </p>
          )}
        </div>
      )}

      {/* ── Entity List ─────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="text-center py-16 text-slate-400">Loading entities...</div>
      ) : entities.length === 0 ? (
        <div className="bg-white border border-slate-100 rounded-4xl p-16 text-center space-y-3">
          <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto text-slate-300">
            <Building2 className="h-8 w-8" />
          </div>
          <p className="text-slate-400 font-medium">No entities yet.</p>
          <button
            onClick={() => setEditing({ ...EMPTY_FORM })}
            className="text-emerald-600 font-bold text-sm hover:underline"
          >
            + Create your first group or property
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Groups with their child properties */}
          {filteredGroups.map((group) => {
            const children = filteredProperties.filter((p) => p.parentId === group.id);
            return (
              <div
                key={group.id}
                className="bg-white rounded-4xl overflow-hidden border border-slate-100 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-slate-100/50 hover:border-slate-200"
              >
                {/* Group header */}
                <div className="p-6 bg-slate-50/50 border-b border-slate-100 flex justify-between items-center">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center font-bold text-xs">
                      {group.code ?? group.name.slice(0, 3).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-800">{group.name}</h3>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-md font-bold uppercase tracking-wider">
                          Group
                        </span>
                        {!group.isActive && (
                          <span className="text-[10px] bg-red-50 text-red-600 px-2 py-0.5 rounded-md font-bold uppercase tracking-wider">
                            Inactive
                          </span>
                        )}
                        <span className="text-[10px] text-slate-400 flex items-center gap-1 ml-1">
                          <Globe className="h-3 w-3" /> {group.functionalCurrency}
                        </span>
                        <span className="text-[10px] text-slate-400 flex items-center gap-1">
                          <MapPin className="h-3 w-3" /> {group.countryCode}
                        </span>
                        <span className="text-[10px] text-slate-400 flex items-center gap-1">
                          <Users className="h-3 w-3" /> {group._count?.users ?? 0}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {children.length} propert{children.length !== 1 ? "ies" : "y"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEdit(group)}
                      className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                      title="Edit group"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                      aria-label="More options"
                      title="More options"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Child properties */}
                {children.length > 0 ? (
                  <div className="divide-y divide-slate-50">
                    {children.map((prop) => (
                      <PropertyRow
                        key={prop.id}
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
                    ))}
                  </div>
                ) : (
                  <div className="p-10 text-center">
                    <p className="text-slate-400 text-sm">No properties in this group.</p>
                    <button
                      onClick={() => setEditing({ ...EMPTY_FORM, parentId: group.id })}
                      className="text-emerald-600 font-bold text-sm hover:underline mt-1"
                    >
                      + Add Property
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* Standalone properties (no parent) */}
          {(() => {
            const standalone = filteredProperties.filter((p) => !p.parentId);
            if (standalone.length === 0 && filteredGroups.length > 0) return null;
            return (
              <div className="bg-white rounded-4xl overflow-hidden border border-slate-100 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-slate-100/50 hover:border-slate-200">
                <div className="p-6 bg-slate-50/50 border-b border-slate-100 flex justify-between items-center">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center font-bold italic text-xs">
                      IND
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-800">Standalone Properties</h3>
                      <span className="text-[10px] bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-md font-bold uppercase tracking-wider">
                        Independent
                      </span>
                    </div>
                  </div>
                </div>
                {standalone.length > 0 ? (
                  <div className="divide-y divide-slate-50">
                    {standalone.map((prop) => (
                      <PropertyRow
                        key={prop.id}
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
                    ))}
                  </div>
                ) : (
                  <div className="p-12 text-center space-y-3">
                    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto text-slate-300">
                      <Hotel className="h-8 w-8" />
                    </div>
                    <p className="text-slate-400 font-medium">No standalone properties found.</p>
                    <button
                      onClick={() => setEditing({ ...EMPTY_FORM })}
                      className="text-emerald-600 font-bold text-sm hover:underline"
                    >
                      + Add Standalone Property
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {deleteMut.isError && (
        <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">
          {deleteMut.error?.message}
        </p>
      )}

      {/* Info banner */}
      {showInfo && (
        <div className="bg-white border border-slate-100 rounded-4xl p-8 flex gap-6 items-center">
          <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 shrink-0">
            <CircleHelp className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <h4 className="font-bold text-slate-800">Organizational Hierarchy</h4>
            <p className="text-sm text-slate-500 leading-relaxed max-w-2xl">
              Groups allow you to consolidate reporting and users across multiple hotels. Properties
              are the base financial entities where transactions occur. Use the entity switcher in
              the sidebar to switch between properties.
            </p>
          </div>
          <button
            onClick={() => setShowInfo(false)}
            className="text-slate-400 hover:text-slate-600 font-semibold text-sm shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

function PropertyRow({
  entity,
  onEdit,
  onDelete,
  confirmDelete,
  onCancelDelete
}: {
  entity: EntitySummaryItem;
  onEdit: () => void;
  onDelete: () => void;
  confirmDelete: boolean;
  onCancelDelete: () => void;
}) {
  return (
    <div className="p-6 flex justify-between items-center group/item transition-colors hover:bg-emerald-50/30">
      <div className="flex items-center gap-6 pl-4 border-l-2 border-emerald-100 ml-2">
        <div>
          <p className="font-semibold text-slate-700">{entity.name}</p>
          <p className="text-xs text-slate-400 font-medium tracking-tight">
            Code: {entity.code ?? "—"}
            <span className="mx-1.5">&#183;</span>
            {entity.functionalCurrency}
            <span className="mx-1.5">&#183;</span>
            {entity.countryCode} {entity.city ? `· ${entity.city}` : ""}
            <span className="mx-1.5">&#183;</span>
            {entity._count?.users ?? 0} users
          </p>
        </div>
        <span className="text-[10px] bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-md font-bold uppercase tracking-wider">
          Property
        </span>
        {!entity.isActive && (
          <span className="text-[10px] bg-red-50 text-red-600 px-2 py-0.5 rounded-md font-bold uppercase tracking-wider">
            Inactive
          </span>
        )}
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-xs font-bold text-slate-800">
            {entity.isActive ? "Active" : "Inactive"}
          </p>
          <p className="text-[10px] text-slate-400">Status</p>
        </div>
        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <button
              onClick={onDelete}
              className="bg-red-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-red-700 transition-colors"
            >
              Confirm Delete
            </button>
            <button
              onClick={onCancelDelete}
              className="bg-slate-100 text-slate-600 px-4 py-2 rounded-xl text-xs font-bold hover:bg-slate-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1 opacity-0 group-hover/item:opacity-100 transition-all">
            <button
              onClick={onEdit}
              className="bg-emerald-50 text-emerald-700 px-4 py-2 rounded-xl text-xs font-bold transition-all hover:bg-emerald-600 hover:text-white"
            >
              Manage Settings
            </button>
            <button
              onClick={onDelete}
              className="p-2 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
