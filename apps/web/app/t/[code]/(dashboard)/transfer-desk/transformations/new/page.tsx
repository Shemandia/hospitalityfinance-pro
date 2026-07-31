"use client";

/**
 * Transfer Desk — Transformation creation wizard
 *
 * 3-step wizard: Name/description → Source/Target selection → Review & Save.
 * After save, redirects to the detail page where the Visual Mapper lives.
 */

import Link from "next/link";
import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useApiContext } from "../../../../../../../components/use-api-context";
import { useTenantHref } from "../../../../../../../hooks/use-tenant-router";
import {
  createTransferTransformation,
  listTransferFormats,
  type TransformationCreateInput,
  type TransferFormatSummary
} from "../../../../../../../lib/gl-api";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../../../../components/ui/card";
import { Button } from "../../../../../../../components/ui/button";
import { Badge } from "../../../../../../../components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../../../../components/ui/select";
import { ArrowLeft, ArrowRight, Check, Workflow } from "lucide-react";

const COMPONENTS = ["GL_JOURNAL", "AP_INVOICE", "AR_INVOICE"] as const;

type WizardStep = 1 | 2 | 3;

export default function NewTransformationPage() {
  const apiCtx = useApiContext();
  const router = useRouter();
  const href = useTenantHref();

  const [step, setStep] = useState<WizardStep>(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sourceType, setSourceType] = useState<"format" | "component">("format");
  const [sourceFormatId, setSourceFormatId] = useState("");
  const [sourceComponent, setSourceComponent] = useState("");
  const [targetType, setTargetType] = useState<"component" | "format">("component");
  const [targetFormatId, setTargetFormatId] = useState("");
  const [targetComponent, setTargetComponent] = useState("");

  const { data: formatsData } = useQuery({
    queryKey: ["transfer-formats"],
    queryFn: () => listTransferFormats(apiCtx!)
  });
  const formats: TransferFormatSummary[] = formatsData?.data ?? [];

  const saveMutation = useMutation({
    mutationFn: (input: TransformationCreateInput) => createTransferTransformation(apiCtx!, input),
    onSuccess: (result) => {
      const id = result?.data?.id;
      if (id) {
        router.push(href(`/transfer-desk/transformations/${id}`));
      } else {
        router.push(href("/transfer-desk/transformations"));
      }
    }
  });

  const handleSave = useCallback(() => {
    saveMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      sourceFormatId: sourceType === "format" && sourceFormatId ? sourceFormatId : undefined,
      sourceComponent: sourceType === "component" && sourceComponent ? sourceComponent : undefined,
      targetFormatId: targetType === "format" && targetFormatId ? targetFormatId : undefined,
      targetComponent: targetType === "component" && targetComponent ? targetComponent : undefined,
      rulesJson: []
    });
  }, [
    saveMutation,
    name,
    description,
    sourceType,
    sourceFormatId,
    sourceComponent,
    targetType,
    targetFormatId,
    targetComponent
  ]);

  const canAdvanceStep1 = name.trim().length > 0;
  const canAdvanceStep2 =
    (sourceType === "format" ? !!sourceFormatId : !!sourceComponent) &&
    (targetType === "format" ? !!targetFormatId : !!targetComponent);

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href={href("/transfer-desk/transformations")}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New Transformation</h1>
          <p className="text-sm text-muted-foreground">Step {step} of 3</p>
        </div>
      </div>

      {/* Step indicators */}
      <div className="flex gap-2">
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className={`h-1.5 flex-1 rounded-full ${s <= step ? "bg-emerald-500" : "bg-slate-200"}`}
          />
        ))}
      </div>

      {/* Step 1: Name & Description */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Workflow className="h-4 w-4" />
              Basic Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium">Transformation Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Jana Internal Movement ÷1000"
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this transformation do?"
                rows={3}
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setStep(2)} disabled={!canAdvanceStep1}>
                Next <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Source & Target */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Source & Target</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Source */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-700">Source</h3>
              <div className="flex gap-2">
                <Button
                  variant={sourceType === "format" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSourceType("format")}
                >
                  File Format
                </Button>
                <Button
                  variant={sourceType === "component" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSourceType("component")}
                >
                  HFP Component
                </Button>
              </div>
              {sourceType === "format" ? (
                <Select value={sourceFormatId} onValueChange={setSourceFormatId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select source format..." />
                  </SelectTrigger>
                  <SelectContent>
                    {formats.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Select value={sourceComponent} onValueChange={setSourceComponent}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select source component..." />
                  </SelectTrigger>
                  <SelectContent>
                    {COMPONENTS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Target */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-700">Target</h3>
              <div className="flex gap-2">
                <Button
                  variant={targetType === "format" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTargetType("format")}
                >
                  File Format
                </Button>
                <Button
                  variant={targetType === "component" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTargetType("component")}
                >
                  HFP Component
                </Button>
              </div>
              {targetType === "format" ? (
                <Select value={targetFormatId} onValueChange={setTargetFormatId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select target format..." />
                  </SelectTrigger>
                  <SelectContent>
                    {formats.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Select value={targetComponent} onValueChange={setTargetComponent}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select target component..." />
                  </SelectTrigger>
                  <SelectContent>
                    {COMPONENTS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <Button onClick={() => setStep(3)} disabled={!canAdvanceStep2}>
                Next <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Review & Save */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Review & Create</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border bg-slate-50 p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Name</span>
                <span className="font-medium">{name}</span>
              </div>
              {description && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Description</span>
                  <span className="text-right max-w-[60%]">{description}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">Source</span>
                <Badge variant="outline">
                  {sourceType === "format"
                    ? (formats.find((f) => f.id === sourceFormatId)?.name ?? sourceFormatId)
                    : sourceComponent}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Target</span>
                <Badge variant="outline">
                  {targetType === "format"
                    ? (formats.find((f) => f.id === targetFormatId)?.name ?? targetFormatId)
                    : targetComponent}
                </Badge>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              After creating, you'll be taken to the Visual Mapper to define transformation rules.
            </p>

            {saveMutation.error && (
              <p className="text-sm text-red-600">
                Failed to create: {(saveMutation.error as Error).message}
              </p>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <Button onClick={handleSave} disabled={saveMutation.isPending}>
                <Check className="mr-2 h-4 w-4" />
                {saveMutation.isPending ? "Creating..." : "Create Transformation"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
