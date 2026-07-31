"use client";

/**
 * FieldMapper — Visual three-column drag-and-drop field mapper (§11).
 *
 * Left panel:  Source fields (from FSD schema or HFP data model)
 * Center:      Connection list with mapping lines + transform labels
 * Right panel: Target fields (HFP journal fields)
 *
 * Uses @dnd-kit/core for drag-and-drop.
 */

import { useCallback, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import type {
  FsdFieldConfig,
  HfpTargetField,
  TmlMapping,
  TmlTransform
} from "../../../../lib/transfer-desk/types";
import { TRANSFORM_TYPES } from "../../../../lib/transfer-desk/constants";
import type { FieldMapperState } from "../../../../lib/transfer-desk/hooks/useFieldMapper";
import { TransformConfigPanel } from "./TransformConfigPanel";
import { Button } from "../../../ui/button";
import { Badge } from "../../../ui/badge";
import { Input } from "../../../ui/input";
import {
  Wand2,
  Plus,
  Trash2,
  GripVertical,
  AlertTriangle,
  ArrowRight,
  Search,
  X
} from "lucide-react";

// ── Props ───────────────────────────────────────────────────────────────────

type FieldMapperProps = {
  sourceFields: FsdFieldConfig[];
  targetFields: HfpTargetField[];
  mapper: FieldMapperState;
};

// ── Main Component ──────────────────────────────────────────────────────────

export function FieldMapper({ sourceFields, targetFields, mapper }: FieldMapperProps) {
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [sourceSearch, setSourceSearch] = useState("");
  const [targetSearch, setTargetSearch] = useState("");

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // ── Drag handlers ───────────────────────────────────────────────────────

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveSourceId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveSourceId(null);
      const sourceId = event.active.id as string;
      const targetId = event.over?.id as string | undefined;
      if (targetId && targetId.startsWith("target:")) {
        const targetPath = targetId.replace("target:", "");
        mapper.handleDrop(sourceId, targetPath);
      }
    },
    [mapper]
  );

  // ── Filtered lists ──────────────────────────────────────────────────────

  const filteredSources = useMemo(() => {
    if (!sourceSearch.trim()) return sourceFields;
    const q = sourceSearch.toLowerCase();
    return sourceFields.filter(
      (f) => f.name.toLowerCase().includes(q) || (f.target ?? "").toLowerCase().includes(q)
    );
  }, [sourceFields, sourceSearch]);

  const targetsByGroup = useMemo(() => {
    const q = targetSearch.toLowerCase();
    const filtered = targetSearch.trim()
      ? targetFields.filter(
          (f) => f.path.toLowerCase().includes(q) || f.label.toLowerCase().includes(q)
        )
      : targetFields;

    const groups: Record<string, HfpTargetField[]> = {};
    for (const field of filtered) {
      (groups[field.group] ??= []).push(field);
    }
    return groups;
  }, [targetFields, targetSearch]);

  // ── Unmapped required targets ───────────────────────────────────────────

  const unmappedRequired = useMemo(
    () => targetFields.filter((t) => t.required && !mapper.mappedTargetPaths.has(t.path)),
    [targetFields, mapper.mappedTargetPaths]
  );

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="space-y-3">
        {/* Toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => mapper.autoMap(sourceFields, targetFields)}
            className="gap-1.5 text-xs"
          >
            <Wand2 className="h-3.5 w-3.5" /> Auto-Map by Name
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              // Prompt: pick an unmapped required target for static mapping
              const first = unmappedRequired[0];
              if (first) mapper.addStaticMapping(first.path);
            }}
            className="gap-1.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" /> Add Static Mapping
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={mapper.clearAll}
            disabled={mapper.mappings.length === 0}
            className="gap-1.5 text-xs text-red-500 hover:text-red-600"
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear All
          </Button>
          <span className="text-xs text-slate-400 ml-auto">
            {mapper.mappings.length} mapping{mapper.mappings.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Unmapped required warning */}
        {unmappedRequired.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              {unmappedRequired.length} required target field
              {unmappedRequired.length > 1 ? "s" : ""} unmapped:{" "}
              {unmappedRequired
                .slice(0, 5)
                .map((f) => f.label)
                .join(", ")}
              {unmappedRequired.length > 5 && ` +${unmappedRequired.length - 5} more`}
            </span>
          </div>
        )}

        {/* Three-column layout */}
        <div className="grid grid-cols-[1fr_auto_1fr] gap-3 min-h-[400px]">
          {/* Left: Source Fields */}
          <div className="rounded-lg border border-slate-200 flex flex-col">
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/50">
              <h4 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                Source Fields
              </h4>
              <div className="relative">
                <Search className="h-3 w-3 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  value={sourceSearch}
                  onChange={(e) => setSourceSearch(e.target.value)}
                  placeholder="Filter..."
                  className="h-7 pl-7 text-[11px]"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {filteredSources.map((field) => (
                <DraggableSourceField
                  key={field.name}
                  field={field}
                  isMapped={mapper.mappedSourceNames.has(field.name)}
                />
              ))}
              {filteredSources.length === 0 && (
                <p className="text-xs text-slate-400 py-4 text-center">
                  {sourceFields.length === 0
                    ? "No source fields. Define file format in Step 2."
                    : "No fields match filter."}
                </p>
              )}
            </div>
          </div>

          {/* Center: Mapping Lines */}
          <div className="w-64 rounded-lg border border-slate-200 flex flex-col">
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/50">
              <h4 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Mappings
              </h4>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {mapper.mappings.length === 0 ? (
                <p className="text-xs text-slate-400 py-8 text-center px-2">
                  Drag source fields onto targets, or use Auto-Map.
                </p>
              ) : (
                mapper.mappings.map((m) => (
                  <MappingLine
                    key={m.id}
                    mapping={m}
                    isSelected={m.id === mapper.selectedMappingId}
                    onSelect={() => mapper.selectMapping(m.id)}
                    onRemove={() => mapper.removeMapping(m.id)}
                  />
                ))
              )}
            </div>
          </div>

          {/* Right: Target Fields */}
          <div className="rounded-lg border border-slate-200 flex flex-col">
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/50">
              <h4 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                HFP Target Fields
              </h4>
              <div className="relative">
                <Search className="h-3 w-3 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  value={targetSearch}
                  onChange={(e) => setTargetSearch(e.target.value)}
                  placeholder="Filter..."
                  className="h-7 pl-7 text-[11px]"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {Object.entries(targetsByGroup).map(([group, fields]) => (
                <div key={group}>
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-1 mb-1">
                    {group}
                  </p>
                  <div className="space-y-1">
                    {fields.map((field) => (
                      <DroppableTargetField
                        key={field.path}
                        field={field}
                        isMapped={mapper.mappedTargetPaths.has(field.path)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Transform config panel (slide-in) */}
        {mapper.selectedMapping && (
          <TransformConfigPanel
            transform={mapper.selectedMapping.transform}
            sourceField={mapper.selectedMapping.sourceField}
            targetField={mapper.selectedMapping.targetField}
            onApply={(transform) => {
              mapper.updateMappingTransform(mapper.selectedMappingId!, transform);
              mapper.selectMapping(null);
            }}
            onCancel={() => mapper.selectMapping(null)}
          />
        )}
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activeSourceId ? (
          <div className="rounded-lg bg-white border-2 border-emerald-400 shadow-lg px-3 py-1.5 text-xs font-mono text-emerald-700">
            {activeSourceId}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// ── Draggable Source Field ───────────────────────────────────────────────────

function DraggableSourceField({ field, isMapped }: { field: FsdFieldConfig; isMapped: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: field.name
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`
        flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs cursor-grab
        transition-colors border
        ${isDragging ? "opacity-50" : ""}
        ${
          isMapped
            ? "bg-emerald-50/50 border-emerald-200 text-emerald-700"
            : "bg-white border-slate-150 text-slate-700 hover:border-slate-300"
        }
      `}
    >
      <GripVertical className="h-3 w-3 text-slate-300 shrink-0" />
      <span className="font-mono truncate flex-1">{field.name}</span>
      <span className="text-[9px] text-slate-400 shrink-0">{field.type}</span>
    </div>
  );
}

// ── Droppable Target Field ──────────────────────────────────────────────────

function DroppableTargetField({ field, isMapped }: { field: HfpTargetField; isMapped: boolean }) {
  const { isOver, setNodeRef } = useDroppable({
    id: `target:${field.path}`
  });

  return (
    <div
      ref={setNodeRef}
      className={`
        flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs
        transition-colors border
        ${isOver ? "bg-emerald-100 border-emerald-400 ring-2 ring-emerald-200" : ""}
        ${
          isMapped
            ? "bg-emerald-50/50 border-emerald-200 text-emerald-700"
            : field.required
              ? "bg-amber-50/30 border-amber-200 text-slate-700"
              : "bg-white border-slate-150 text-slate-700"
        }
      `}
    >
      <span className="font-mono truncate flex-1">{field.path}</span>
      <span className="text-[9px] text-slate-400 shrink-0">{field.label}</span>
      {field.required && !isMapped && <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />}
      {isMapped && (
        <Badge variant="success" className="text-[8px] px-1 py-0 shrink-0">
          mapped
        </Badge>
      )}
    </div>
  );
}

// ── Mapping Line ────────────────────────────────────────────────────────────

function MappingLine({
  mapping,
  isSelected,
  onSelect,
  onRemove
}: {
  mapping: TmlMapping;
  isSelected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const transformLabel = mapping.transform
    ? (TRANSFORM_TYPES.find((t) => t.value === mapping.transform!.type)?.label ??
      mapping.transform.type)
    : "Direct";

  const sourceDisplay = mapping.sourceField === "__static__" ? "(static)" : mapping.sourceField;

  return (
    <div
      onClick={onSelect}
      className={`
        flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] cursor-pointer
        transition-colors border group
        ${
          isSelected
            ? "bg-emerald-50 border-emerald-300 ring-1 ring-emerald-200"
            : "bg-white border-slate-150 hover:border-slate-300"
        }
      `}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 truncate">
          <span className="font-mono text-slate-600 truncate">{sourceDisplay}</span>
          <ArrowRight className="h-3 w-3 text-slate-300 shrink-0" />
          <span className="font-mono text-slate-600 truncate">{mapping.targetField}</span>
        </div>
        <span className="text-[9px] text-emerald-600 font-medium">{transformLabel}</span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500"
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}
