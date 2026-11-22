import path from "node:path";
import { careerOpsRoot, readApplications } from "@/lib/career-ops";
import { readSavedJobs, enrichSavedJobs } from "@/lib/saved-jobs-store.mjs";
import type { SavedJob } from "@/lib/saved-job";

export function readSavedJobsFromDisk(): SavedJob[] {
  return enrichSavedJobs(readSavedJobs(path.join(careerOpsRoot(), "data", "saved-jobs.json")), readApplications()) as SavedJob[];
}
