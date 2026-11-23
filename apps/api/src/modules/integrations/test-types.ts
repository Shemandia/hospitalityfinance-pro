import { z } from "zod";

// ── Test execution input ─────────────────────────────────────────────────────

export const testExecuteSchema = z.object({
  /** Base64-encoded test file content */
  file: z.string().min(1),
  /** Original filename */
  filename: z.string().min(1).max(255)
});

export type TestExecuteInput = z.infer<typeof testExecuteSchema>;
