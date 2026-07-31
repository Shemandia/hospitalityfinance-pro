"use client";

/**
 * ProgressStream — Visual progress indicator for test execution.
 *
 * Shows a progress bar with step label and row counter,
 * driven by SSE progress events from the test stream.
 */

import type { TestStreamStatus } from "../../../../lib/transfer-desk/hooks/useTestStream";
import type { TestProgressEvent } from "../../../../lib/transfer-desk/types";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

type ProgressStreamProps = {
  status: TestStreamStatus;
  progress: TestProgressEvent | null;
  error: string | null;
};

const STEP_LABELS: Record<string, string> = {
  parsing: "Parsing file",
  mapping: "Applying field mappings",
  validation: "Running validation rules",
  complete: "Complete"
};

export function ProgressStream({ status, progress, error }: ProgressStreamProps) {
  if (status === "idle") return null;

  const stepLabel = progress ? (STEP_LABELS[progress.step] ?? progress.step) : "Connecting...";
  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.current / progress.total) * 100))
      : 0;

  return (
    <div className="rounded-lg border border-slate-200 p-4 space-y-3">
      {/* Status header */}
      <div className="flex items-center gap-2">
        {status === "connecting" && <Loader2 className="h-4 w-4 text-emerald-600 animate-spin" />}
        {status === "streaming" && <Loader2 className="h-4 w-4 text-emerald-600 animate-spin" />}
        {status === "complete" && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
        {status === "error" && <XCircle className="h-4 w-4 text-red-500" />}
        <span className="text-sm font-medium text-slate-700">{stepLabel}</span>
        {progress && progress.total > 0 && (
          <span className="text-xs text-slate-400 ml-auto tabular-nums">
            {progress.current} / {progress.total} rows
          </span>
        )}
      </div>

      {/* Progress bar */}
      {(status === "streaming" || status === "connecting") && (
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* Complete bar */}
      {status === "complete" && <div className="h-2 rounded-full bg-emerald-500" />}

      {/* Error message */}
      {status === "error" && error && <p className="text-xs text-red-600">{error}</p>}

      {/* Step message */}
      {progress?.message && <p className="text-xs text-slate-500">{progress.message}</p>}
    </div>
  );
}
