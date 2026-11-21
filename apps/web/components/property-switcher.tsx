"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Building2, Check, ChevronDown, Layers, Search } from "lucide-react";
import { useEntity } from "./entity-provider";
import { buildPropertyTree, filterPropertyTree, shortLabel } from "../lib/property-tree";

/**
 * The property switcher in the top bar.
 *
 * The list is the access context's entities, drawn as a tree (properties
 * under their group) with each one's functional currency. Choosing one goes
 * through the entity provider, which remembers it per tenant and user. On
 * narrow screens the button shows the property code only.
 */
export function PropertySwitcher() {
  const { entities, currentEntity, switchEntity, isLoading } = useEntity();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const tree = useMemo(() => buildPropertyTree(entities), [entities]);
  const rows = useMemo(() => filterPropertyTree(tree, query), [tree, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    inputRef.current?.focus();
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Start on the current entity when opening, on the first match while searching.
  useEffect(() => {
    if (!open) return;
    const index = query ? 0 : rows.findIndex((r) => r.entity.id === currentEntity?.id);
    setActive(Math.max(0, index));
  }, [open, query, rows, currentEntity?.id]);

  if (isLoading) {
    return <div className="h-9 w-24 sm:w-48 rounded-xl bg-slate-100 animate-pulse" aria-hidden />;
  }
  if (!currentEntity) return null;

  const canSwitch = entities.length > 1;

  function close() {
    setOpen(false);
    setQuery("");
  }

  function choose(id: string) {
    if (id !== currentEntity?.id) switchEntity(id);
    close();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(rows.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[active];
      if (row) choose(row.entity.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  const Icon = currentEntity.type === "PROPERTY" ? Building2 : Layers;

  return (
    <div ref={rootRef} className="relative min-w-0 shrink-0 sm:shrink">
      <button
        type="button"
        onClick={() => (open ? close() : canSwitch && setOpen(true))}
        aria-expanded={open}
        aria-haspopup={canSwitch ? "dialog" : undefined}
        aria-label={`Property: ${currentEntity.name}${canSwitch ? ". Switch property" : ""}`}
        title={currentEntity.name}
        className={`flex items-center gap-2 min-w-0 max-w-[11rem] sm:max-w-[16rem] lg:max-w-[20rem] px-2.5 py-1.5 lg:py-2 rounded-xl border text-left transition-colors ${
          open ? "bg-emerald-50 border-emerald-200" : "bg-white border-slate-200 hover:bg-slate-50"
        } ${canSwitch ? "cursor-pointer" : "cursor-default"}`}
      >
        <Icon className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
        <span className="sm:hidden text-sm font-semibold text-slate-800 truncate">
          {shortLabel(currentEntity)}
        </span>
        <span className="hidden sm:inline text-sm font-semibold text-slate-800 truncate">
          {currentEntity.name}
        </span>
        <span className="hidden sm:inline shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
          {currentEntity.functionalCurrency}
        </span>
        {canSwitch && (
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden
          />
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Switch property"
          className="absolute left-0 top-full mt-1.5 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-xl bg-white border border-slate-200 shadow-xl shadow-slate-200/50"
        >
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search
                className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400"
                aria-hidden
              />
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={
                  rows[active] ? `${listId}-${rows[active].entity.id}` : undefined
                }
                aria-label="Search properties"
                placeholder="Search name, code or currency"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                className="w-full pl-8 pr-2 py-1.5 text-sm rounded-lg border border-slate-200 outline-none focus:ring-2 ring-emerald-500 placeholder:text-slate-400"
              />
            </div>
          </div>
          <ul
            id={listId}
            role="listbox"
            aria-label="Properties"
            className="max-h-80 overflow-y-auto p-1.5"
          >
            {rows.length === 0 && (
              <li className="px-3 py-4 text-center text-xs text-slate-400">No property matches.</li>
            )}
            {rows.map(({ entity, depth }, index) => {
              const selected = entity.id === currentEntity.id;
              const RowIcon = entity.type === "PROPERTY" ? Building2 : Layers;
              return (
                <li
                  key={entity.id}
                  id={`${listId}-${entity.id}`}
                  role="option"
                  aria-selected={selected}
                  aria-level={depth + 1}
                  data-depth={depth}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(entity.id)}
                  style={{ paddingLeft: `${0.625 + depth * 1.25}rem` }}
                  className={`flex items-center gap-2 pr-2.5 py-2 rounded-lg cursor-pointer text-sm ${
                    index === active ? "bg-slate-100" : ""
                  } ${selected ? "text-emerald-700 font-semibold" : "text-slate-700"} ${
                    entity.isActive ? "" : "opacity-60"
                  }`}
                >
                  <RowIcon
                    className={`h-3.5 w-3.5 shrink-0 ${selected ? "text-emerald-600" : "text-slate-400"}`}
                    aria-hidden
                  />
                  <span className="flex-1 min-w-0 truncate" title={entity.name}>
                    {entity.name}
                    {entity.code && (
                      <span className="ml-1.5 text-[11px] font-normal text-slate-400">
                        {entity.code}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-[11px] font-medium text-slate-500 tabular-nums">
                    {entity.functionalCurrency}
                  </span>
                  <Check
                    className={`h-3.5 w-3.5 shrink-0 ${selected ? "text-emerald-600" : "invisible"}`}
                    aria-hidden
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
