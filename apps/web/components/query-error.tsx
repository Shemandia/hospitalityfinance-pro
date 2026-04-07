"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "./ui/button";

type QueryErrorProps = {
  message?: string;
  onRetry?: () => void;
};

export function QueryError({ message, onRetry }: QueryErrorProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <AlertTriangle className="h-8 w-8 text-destructive/60" />
      <p className="text-sm text-muted-foreground max-w-sm">
        {message || "Failed to load data. Please try again."}
      </p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
