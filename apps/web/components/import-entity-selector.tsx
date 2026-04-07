"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, AlertCircle } from "lucide-react";
import { useEntity } from "./entity-provider";
import { Card, CardContent } from "./ui/card";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

export type ImportEntityState = {
  /** Selected property entity ID, or null if none picked */
  entityId: string | null;
  /** True when an entity is selected and ready for import */
  isValid: boolean;
  /** Validation message to surface near action buttons (or null when valid) */
  validationMessage: string | null;
};

const VALIDATION_MESSAGE = "Please select a property before importing";

/**
 * Hook that owns the import-specific entity selection.
 *
 * Pre-selects the sidebar entity if it is a PROPERTY. If the sidebar is on
 * a GROUP (or there is no sidebar selection), the import entity starts empty
 * and the user must explicitly pick a property.
 *
 * The selection is local to the page — it does NOT mutate the sidebar entity.
 */
export function useImportEntity(): ImportEntityState & {
  setEntityId: (id: string) => void;
} {
  const { currentEntity } = useEntity();
  const [entityId, setEntityId] = useState<string | null>(null);

  // Pre-fill from sidebar entity if it's a property and we don't have a pick yet
  useEffect(() => {
    if (entityId) return;
    if (currentEntity && currentEntity.type === "PROPERTY") {
      setEntityId(currentEntity.id);
    }
  }, [currentEntity, entityId]);

  const isValid = !!entityId;
  return {
    entityId,
    setEntityId,
    isValid,
    validationMessage: isValid ? null : VALIDATION_MESSAGE
  };
}

type Props = {
  entityId: string | null;
  onChange: (id: string) => void;
  /** Override the default label */
  label?: string;
  /** Override the default helper text */
  helperText?: string;
};

/**
 * Property selector shown at the top of import pages.
 *
 * Forces the user to confirm which property the imported data belongs to,
 * independent of the sidebar entity switcher. Lists only PROPERTY-type
 * entities the user has access to.
 */
export function ImportEntitySelector({
  entityId,
  onChange,
  label = "Import into property",
  helperText = "Select the property the imported data belongs to. This is independent of the sidebar entity."
}: Props) {
  const { entities, isLoading } = useEntity();

  const properties = useMemo(
    () => entities.filter((e) => e.type === "PROPERTY" && e.isActive),
    [entities]
  );

  const noProperties = !isLoading && properties.length === 0;
  const showValidation = !isLoading && !entityId && !noProperties;

  return (
    <Card className="border-(--color-primary)/20 bg-(--color-primary)/[0.02]">
      <CardContent className="py-3 sm:py-4 space-y-2">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0 bg-emerald-100">
            <Building2 className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0 space-y-1.5">
            <Label className="text-xs sm:text-sm font-medium">{label}</Label>
            {isLoading ? (
              <div className="h-9 w-full max-w-sm rounded-md bg-muted animate-pulse" />
            ) : noProperties ? (
              <p className="text-xs sm:text-sm text-destructive">
                No properties available. Contact your administrator to be granted access to a
                property.
              </p>
            ) : (
              <Select value={entityId ?? ""} onValueChange={onChange}>
                <SelectTrigger className="w-full max-w-sm">
                  <SelectValue placeholder="Choose a property…" />
                </SelectTrigger>
                <SelectContent>
                  {properties.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="font-medium">{p.name}</span>
                      <span className="text-muted-foreground ml-2 text-[10px]">
                        {p.functionalCurrency}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-[11px] text-muted-foreground">{helperText}</p>
            {showValidation && (
              <p className="text-xs text-destructive flex items-center gap-1 pt-0.5">
                <AlertCircle className="h-3 w-3 shrink-0" />
                {VALIDATION_MESSAGE}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
