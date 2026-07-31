"use client";

import { useEffect } from "react";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/card";

export default function DashboardError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard error:", error);
  }, [error]);

  return (
    <div className="flex items-center justify-center min-h-[60vh] p-6">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle className="text-destructive">Something went wrong</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            An unexpected error occurred. Please try again or contact support.
          </p>
          {error.digest && (
            <p className="text-xs text-muted-foreground/60 font-mono">Error ID: {error.digest}</p>
          )}
          <Button onClick={reset} variant="outline" className="w-full">
            Try Again
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
