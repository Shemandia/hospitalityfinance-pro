"use client";

import { Building2, ChevronDown, Check } from "lucide-react";
import { useEntity } from "./entity-provider";
import { useState, useRef, useEffect } from "react";

export function EntitySwitcher() {
  const { entities, currentEntity, switchEntity, isLoading } = useEntity();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
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
      <div className="px-3 py-2.5 mx-2 rounded-md bg-white/5 animate-pulse">
        <div className="h-4 w-32 bg-white/10 rounded" />
      </div>
    );
  }

  if (!currentEntity) return null;

  const isMulti = entities.length > 1;

  return (
    <div ref={ref} className="relative mx-2 mb-2">
      <button
        type="button"
        onClick={() => isMulti && setOpen(!open)}
        className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md bg-white/5 border border-white/10 transition-colors ${
          isMulti ? "hover:bg-white/10 cursor-pointer" : "cursor-default"
        }`}
      >
        <Building2 className="h-4 w-4 text-(--color-accent) shrink-0" />
        <div className="flex-1 min-w-0 text-left">
          <p className="text-xs font-medium text-white truncate">{currentEntity.name}</p>
          <p className="text-[10px] text-white/50 truncate">
            {currentEntity.type === "GROUP" ? "Group" : "Property"} ·{" "}
            {currentEntity.functionalCurrency ?? currentEntity.currency}
          </p>
        </div>
        {isMulti && (
          <ChevronDown
            className={`h-3.5 w-3.5 text-white/40 shrink-0 transition-transform duration-200 ${
              open ? "rotate-180" : ""
            }`}
          />
        )}
      </button>

      {/* Dropdown */}
      {open && isMulti && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-md border border-white/10 bg-(--color-primary) shadow-lg max-h-64 overflow-y-auto">
          {entities.map((entity) => {
            const isSelected = entity.id === currentEntity.id;
            return (
              <button
                key={entity.id}
                type="button"
                onClick={() => {
                  if (!isSelected) switchEntity(entity.id);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                  isSelected
                    ? "bg-white/10 text-white"
                    : "text-white/70 hover:bg-white/5 hover:text-white"
                }`}
              >
                <Building2 className="h-3.5 w-3.5 shrink-0 opacity-60" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{entity.name}</p>
                  <p className="text-[10px] text-white/40 truncate">
                    {entity.type === "GROUP" ? "Group" : "Property"} ·{" "}
                    {entity.functionalCurrency ?? entity.currency}
                  </p>
                </div>
                {isSelected && <Check className="h-3.5 w-3.5 text-(--color-accent) shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
