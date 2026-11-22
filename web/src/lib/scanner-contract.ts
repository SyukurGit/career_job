export type ScannerState = "running" | "cancelling" | "complete" | "partial" | "error" | "cancelled";
export type ScannerCoverage = {
  status: "complete" | "partial" | "error" | "cancelled";
  attempted: number | null;
  succeeded: number | null;
  failed: number | null;
  sources: { id: string; company?: string; status: "complete" | "partial" | "error"; reason?: string; found?: number }[];
};
export type ScannerRun = {
  runId: string;
  status: ScannerState;
  startedAt: string;
  completedAt?: string;
  since: string;
  fresh: boolean;
  exitCode?: number | null;
  rawFound?: number | null;
  admitted?: number | null;
  rejected?: number | null;
  newAdded?: number | null;
  coverage?: ScannerCoverage;
  message?: string;
};
export type ScannerEvent = { type: string; id: number; data: ScannerRun & { text?: string } };
