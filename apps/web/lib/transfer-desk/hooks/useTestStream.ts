"use client";

/**
 * useTestStream — SSE hook for streaming Transfer Desk test progress.
 *
 * Uses EventSource API to listen for progress and complete events
 * from the test execution endpoint.
 */

import { useCallback, useRef, useState } from "react";
import { getTestStreamUrl, getTestResults } from "../api";
import type { ApiContext } from "../../gl-api";
import type { TestProgressEvent, TestSummary, TestResults } from "../types";

export type TestStreamStatus = "idle" | "connecting" | "streaming" | "complete" | "error";

export type UseTestStreamReturn = {
  status: TestStreamStatus;
  progress: TestProgressEvent | null;
  summary: TestSummary | null;
  results: TestResults | null;
  error: string | null;
  start: (profileId: string, testId: string, apiContext: ApiContext) => void;
  reset: () => void;
};

export function useTestStream(): UseTestStreamReturn {
  const [status, setStatus] = useState<TestStreamStatus>("idle");
  const [progress, setProgress] = useState<TestProgressEvent | null>(null);
  const [summary, setSummary] = useState<TestSummary | null>(null);
  const [results, setResults] = useState<TestResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const reset = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setStatus("idle");
    setProgress(null);
    setSummary(null);
    setResults(null);
    setError(null);
  }, []);

  const start = useCallback((profileId: string, testId: string, apiContext: ApiContext) => {
    // Clean up any existing connection
    if (esRef.current) {
      esRef.current.close();
    }

    setStatus("connecting");
    setProgress(null);
    setSummary(null);
    setResults(null);
    setError(null);

    const url = getTestStreamUrl(profileId, testId);
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      setStatus("streaming");
    };

    es.addEventListener("progress", (event) => {
      try {
        const data = JSON.parse(event.data) as TestProgressEvent;
        setProgress(data);
      } catch {
        // ignore malformed progress events
      }
    });

    es.addEventListener("complete", async (event) => {
      try {
        const data = JSON.parse(event.data) as { summary: TestSummary };
        setSummary(data.summary);
        setStatus("complete");
      } catch {
        // ignore
      }

      // Close the stream
      es.close();
      esRef.current = null;

      // Fetch full results
      try {
        const res = await getTestResults(apiContext, profileId, testId);
        setResults(res.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load results");
      }
    });

    es.addEventListener("error", (event) => {
      // SSE error event — check if the connection was intentionally closed
      if (es.readyState === EventSource.CLOSED) return;

      const msg =
        event instanceof MessageEvent && event.data ? String(event.data) : "Connection lost";
      setError(msg);
      setStatus("error");
      es.close();
      esRef.current = null;
    });
  }, []);

  return { status, progress, summary, results, error, start, reset };
}
