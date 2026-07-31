"use client";

/**
 * FileUploadZone — Drag-and-drop file upload area for Transfer Desk.
 *
 * Uses native HTML5 drag-and-drop (no react-dropzone dependency).
 * Validates: max file size (10 MB), allowed extensions.
 */

import { useCallback, useRef, useState } from "react";
import { MAX_UPLOAD_SIZE_BYTES, ALLOWED_EXTENSIONS } from "../../../../lib/transfer-desk/constants";
import { UploadCloud, File as FileIcon, X, AlertCircle } from "lucide-react";
import { Button } from "../../../ui/button";

type FileUploadZoneProps = {
  onFileSelect: (file: File) => void;
  /** Currently selected file */
  file: File | null;
  /** Clear the selected file */
  onClear: () => void;
  /** Show loading state while auto-detecting */
  isLoading?: boolean;
  /** Error from parent (e.g. API error) */
  error?: string | null;
};

export function FileUploadZone({
  onFileSelect,
  file,
  onClear,
  isLoading,
  error: externalError
}: FileUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const validateAndSelect = useCallback(
    (f: File) => {
      setValidationError(null);

      // Check size
      if (f.size > MAX_UPLOAD_SIZE_BYTES) {
        setValidationError(`File exceeds 10 MB limit (${(f.size / (1024 * 1024)).toFixed(1)} MB).`);
        return;
      }

      // Check extension
      const ext = "." + f.name.split(".").pop()?.toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        setValidationError(
          `Unsupported file type "${ext}". Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`
        );
        return;
      }

      onFileSelect(f);
    },
    [onFileSelect]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile) validateAndSelect(droppedFile);
    },
    [validateAndSelect]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0];
      if (selected) validateAndSelect(selected);
      // Reset so re-selecting same file triggers change
      e.target.value = "";
    },
    [validateAndSelect]
  );

  const displayError = validationError || externalError;

  // If file is selected, show file info
  if (file) {
    return (
      <div className="rounded-xl border-2 border-dashed border-emerald-200 bg-emerald-50/30 p-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
            <FileIcon className="h-5 w-5 text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-800 truncate">{file.name}</p>
            <p className="text-xs text-slate-500">
              {(file.size / 1024).toFixed(1)} KB
              {isLoading && (
                <span className="ml-2 text-emerald-600 font-medium">Detecting format...</span>
              )}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClear}
            disabled={isLoading}
            className="h-8 w-8 p-0 text-slate-400 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        {displayError && (
          <div className="mt-3 flex items-start gap-2 text-xs text-red-600">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{displayError}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`
        rounded-xl border-2 border-dashed p-8 text-center cursor-pointer
        transition-colors
        ${
          isDragOver
            ? "border-emerald-400 bg-emerald-50"
            : "border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-slate-50"
        }
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_EXTENSIONS.join(",")}
        onChange={handleChange}
        className="hidden"
      />
      <UploadCloud
        className={`h-10 w-10 mx-auto mb-3 ${isDragOver ? "text-emerald-500" : "text-slate-300"}`}
      />
      <p className="text-sm font-medium text-slate-600">
        {isDragOver ? "Drop file here" : "Drop a sample file or click to browse"}
      </p>
      <p className="text-xs text-slate-400 mt-1">Max 10 MB · {ALLOWED_EXTENSIONS.join(", ")}</p>
      {displayError && (
        <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-red-600">
          <AlertCircle className="h-3.5 w-3.5" />
          <span>{displayError}</span>
        </div>
      )}
    </div>
  );
}
