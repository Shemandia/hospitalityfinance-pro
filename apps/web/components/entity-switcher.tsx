"use client";

import { Building2, ChevronDown, Check, Globe } from "lucide-react";
import { useEntity } from "./entity-provider";
import { useState, useRef, useEffect } from "react";

export function EntitySwitcher() {
  const { entities, currentEntity, switchEntity, isLoading } = useEntity();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (isLoading) {
    return (
      <div className="px-3 py-3 mx-3 rounded-xl bg-slate-50 animate-pulse">
        <div className="h-4 w-32 rounded bg-slate-100" />
        <div className="h-3 w-20 rounded bg-slate-100 mt-2" />
      </div>
    );
  }

  if (!currentEntity) return null;

  const isMulti = entities.length > 1;
  const entityType = currentEntity.type === "GROUP" ? "Group" : "Property";
  const currency = currentEntity.functionalCurrency;

  return (
    <div ref={ref} className="relative mx-3 mb-3">
      <button
        type="button"
        onClick={() => isMulti && setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Current entity: ${currentEntity.name}. ${isMulti ? "Click to switch entity" : ""}`}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all duration-200 ${
          open
            ? "bg-emerald-50 border-emerald-200"
            : "bg-slate-50 border-slate-100 hover:bg-slate-100 hover:border-slate-200"
        } ${isMulti ? "cursor-pointer" : "cursor-default"}`}
      >
        <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0 bg-emerald-100">
          <Building2 className="h-4 w-4 text-emerald-600" />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <p className="text-[13px] font-semibold text-slate-800 truncate">{currentEntity.name}</p>
          <p className="text-[11px] text-slate-400 truncate flex items-center gap-1 mt-0.5">
            <Globe className="h-2.5 w-2.5 inline" />
            {entityType} {currency ? `\u00B7 ${currency}` : ""}
          </p>
        </div>
        {isMulti && (
          <ChevronDown
            className={`h-3.5 w-3.5 text-slate-300 shrink-0 transition-transform duration-200 ${
              open ? "rotate-180" : ""
            }`}
          />
        )}
      </button>

      {/* Dropdown */}
      {open && isMulti && (
        <div
          role="listbox"
          aria-label="Select entity"
          className="absolute left-0 right-0 top-full mt-1.5 z-50 rounded-xl max-h-72 overflow-y-auto bg-white border border-slate-200 shadow-xl shadow-slate-200/50 animate-fade-in"
        >
          <div className="p-1.5">
            {entities.map((entity) => {
              const isSelected = entity.id === currentEntity.id;
              return (
                <button
                  key={entity.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    if (!isSelected) switchEntity(entity.id);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-left transition-all duration-200 ${
                    isSelected
                      ? "bg-emerald-50 text-emerald-700"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-800"
                  }`}
                >
                  <Building2
                    className={`h-3.5 w-3.5 shrink-0 ${isSelected ? "text-emerald-600" : "text-slate-400"}`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{entity.name}</p>
                    <p className="text-[10px] text-slate-400 truncate mt-0.5">
                      {entity.type === "GROUP" ? "Group" : "Property"}
                      {entity.functionalCurrency ? ` \u00B7 ${entity.functionalCurrency}` : ""}
                    </p>
                  </div>
                  {isSelected && <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
