"use client";

/**
 * Step 3 — Field Mapping (TML)
 *
 * Visual drag-and-drop mapper: source fields → HFP target fields.
 * Uses @dnd-kit/core via the FieldMapper shared component.
 *
 * Source fields come from Step 2 (FSD schema) if available,
 * or the user can define them inline for non-FSD profile types.
 *
 * React Hook Form + Zod (step3Schema) wraps the mapper output.
 */

import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { step3Schema, type Step3FormData } from "../../../../lib/transfer-desk/validation";
import { HFP_TARGET_FIELDS } from "../../../../lib/transfer-desk/constants";
import type { FsdFieldConfig } from "../../../../lib/transfer-desk/types";
import { useFieldMapper } from "../../../../lib/transfer-desk/hooks/useFieldMapper";
import { FieldMapper } from "../shared/FieldMapper";
import { Form } from "../../../ui/form";

// ── Props ───────────────────────────────────────────────────────────────────

type FieldMappingStepProps = {
  data: Step3FormData | null;
  /** FSD fields from Step 2 (if applicable) */
  sourceFields?: FsdFieldConfig[];
  onSubmit: (data: Step3FormData) => void;
  onValidChange: (valid: boolean) => void;
};

export function FieldMappingStep({
  data,
  sourceFields = [],
  onSubmit,
  onValidChange
}: FieldMappingStepProps) {
  const form = useForm<Step3FormData>({
    resolver: zodResolver(step3Schema),
    defaultValues: data ?? { mappings: [] },
    mode: "onChange"
  });

  const mapper = useFieldMapper({
    initialMappings: data?.mappings ?? []
  });

  // Target fields from constants (typed read-only array → mutable)
  const targetFields = useMemo(() => [...HFP_TARGET_FIELDS], []);

  // Sync mapper state → form state
  useEffect(() => {
    form.setValue("mappings", mapper.mappings, {
      shouldValidate: true,
      shouldDirty: true
    });
  }, [mapper.mappings, form]);

  // Report validity to parent
  const { isValid } = form.formState;
  useEffect(() => {
    onValidChange(isValid);
  }, [isValid, onValidChange]);

  // Propagate valid data to parent
  useEffect(() => {
    if (isValid && mapper.mappings.length > 0) {
      onSubmit({ mappings: mapper.mappings });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isValid, JSON.stringify(mapper.mappings)]);

  return (
    <Form {...form}>
      <form onSubmit={(e) => e.preventDefault()}>
        <FieldMapper sourceFields={sourceFields} targetFields={targetFields} mapper={mapper} />
      </form>
    </Form>
  );
}
