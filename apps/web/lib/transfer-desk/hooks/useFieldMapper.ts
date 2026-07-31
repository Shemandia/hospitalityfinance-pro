"use client";

/**
 * useFieldMapper — Drag-and-drop state, mapping CRUD, and auto-map logic
 * for the Transfer Desk visual field mapper (Step 3).
 *
 * Manages TmlMapping[] array and provides helpers for DnD events,
 * auto-mapping by name similarity, and mapping mutations.
 */

import { useCallback, useState } from "react";
import type { TmlMapping, TmlTransform, TransformType } from "../types";
import type { FsdFieldConfig, HfpTargetField } from "../types";

// ── Helpers ─────────────────────────────────────────────────────────────────

let _idCounter = 0;
function nextId(): string {
  return `mapping_${Date.now()}_${++_idCounter}`;
}

/** Simple fuzzy name match: normalise to lowercase, strip separators, compare */
function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[._\-\s]+/g, "")
    .replace(/^(journal|line|header)/, "");
}

// ── Hook ────────────────────────────────────────────────────────────────────

export type UseFieldMapperOptions = {
  initialMappings?: TmlMapping[];
};

export function useFieldMapper(options: UseFieldMapperOptions = {}) {
  const [mappings, setMappings] = useState<TmlMapping[]>(options.initialMappings ?? []);
  const [selectedMappingId, setSelectedMappingId] = useState<string | null>(null);

  // ── CRUD ────────────────────────────────────────────────────────────────

  const addMapping = useCallback(
    (sourceField: string, targetField: string, transform: TmlTransform | null = null) => {
      // Don't duplicate the same source→target pair
      const exists = mappings.some(
        (m) => m.sourceField === sourceField && m.targetField === targetField
      );
      if (exists) return;

      const mapping: TmlMapping = {
        id: nextId(),
        sourceField,
        targetField,
        transform
      };
      setMappings((prev) => [...prev, mapping]);
    },
    [mappings]
  );

  const addStaticMapping = useCallback((targetField: string, staticValue = "") => {
    const mapping: TmlMapping = {
      id: nextId(),
      sourceField: "__static__",
      targetField,
      transform: { type: "static" as TransformType, staticValue }
    };
    setMappings((prev) => [...prev, mapping]);
  }, []);

  const removeMapping = useCallback((id: string) => {
    setMappings((prev) => prev.filter((m) => m.id !== id));
    setSelectedMappingId((prev) => (prev === id ? null : prev));
  }, []);

  const updateMappingTransform = useCallback((id: string, transform: TmlTransform | null) => {
    setMappings((prev) => prev.map((m) => (m.id === id ? { ...m, transform } : m)));
  }, []);

  const clearAll = useCallback(() => {
    setMappings([]);
    setSelectedMappingId(null);
  }, []);

  // ── DnD handler ─────────────────────────────────────────────────────────

  /** Called when a draggable source field is dropped on a droppable target field */
  const handleDrop = useCallback(
    (sourceField: string, targetField: string) => {
      addMapping(sourceField, targetField, null);
    },
    [addMapping]
  );

  // ── Auto-map by name ────────────────────────────────────────────────────

  const autoMap = useCallback(
    (sourceFields: FsdFieldConfig[], targetFields: HfpTargetField[]) => {
      const newMappings: TmlMapping[] = [...mappings];
      const mappedTargets = new Set(newMappings.map((m) => m.targetField));

      for (const source of sourceFields) {
        const normSource = normaliseName(source.name);

        // Try exact normalised match first
        let bestTarget: HfpTargetField | null = null;
        let bestScore = 0;

        for (const target of targetFields) {
          if (mappedTargets.has(target.path)) continue;
          const normTarget = normaliseName(target.path);

          // Exact match
          if (normSource === normTarget) {
            bestTarget = target;
            bestScore = 1;
            break;
          }

          // Partial: source contains target or vice versa
          if (normSource.includes(normTarget) || normTarget.includes(normSource)) {
            const score =
              Math.min(normSource.length, normTarget.length) /
              Math.max(normSource.length, normTarget.length);
            if (score > bestScore) {
              bestTarget = target;
              bestScore = score;
            }
          }
        }

        if (bestTarget && bestScore >= 0.4) {
          // Check not already mapped for this source
          const alreadyMapped = newMappings.some(
            (m) => m.sourceField === source.name && m.targetField === bestTarget!.path
          );
          if (!alreadyMapped) {
            newMappings.push({
              id: nextId(),
              sourceField: source.name,
              targetField: bestTarget.path,
              transform: null
            });
            mappedTargets.add(bestTarget.path);
          }
        }
      }

      setMappings(newMappings);
    },
    [mappings]
  );

  // ── Selection ───────────────────────────────────────────────────────────

  const selectMapping = useCallback((id: string | null) => {
    setSelectedMappingId(id);
  }, []);

  const selectedMapping = mappings.find((m) => m.id === selectedMappingId) ?? null;

  // ── Computed ────────────────────────────────────────────────────────────

  /** Set of target field paths that have been mapped */
  const mappedTargetPaths = new Set(mappings.map((m) => m.targetField));

  /** Set of source field names that have been mapped */
  const mappedSourceNames = new Set(mappings.map((m) => m.sourceField));

  return {
    mappings,
    setMappings,
    selectedMapping,
    selectedMappingId,

    // CRUD
    addMapping,
    addStaticMapping,
    removeMapping,
    updateMappingTransform,
    clearAll,

    // DnD
    handleDrop,

    // Auto-map
    autoMap,

    // Selection
    selectMapping,

    // Computed
    mappedTargetPaths,
    mappedSourceNames
  };
}

export type FieldMapperState = ReturnType<typeof useFieldMapper>;
