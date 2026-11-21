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
import { step3Schema, type Step3FormData } from "../../../../lib/integrations/validation";
import { useQuery } from "@tanstack/react-query";
import { listTargetFields } from "../../../../lib/integrations/api";
import { useApiContext } from "../../../use-api-context";
import type { FsdFieldConfig } from "../../../../lib/integrations/types";
import { useFieldMapper } from "../../../../lib/integrations/hooks/useFieldMapper";
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

  // Target fields come from the API, which takes them from the posting
  // contract: the keys a transformation writes for a ledger import.
  const apiContext = useApiContext();
  const targetFieldsQuery = useQuery({
    queryKey: ["integrations", "target-fields"],
    queryFn: () => listTargetFields(apiContext!),
    enabled: Boolean(apiContext),
    staleTime: Infinity
  });
  const targetFields = useMemo(
    () => [...(targetFieldsQuery.data?.data ?? [])],
    [targetFieldsQuery.data]
  );

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
