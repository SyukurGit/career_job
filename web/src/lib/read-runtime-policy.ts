import path from "node:path";
import { pathToFileURL } from "node:url";
import * as yaml from "js-yaml";
import { careerOpsRoot, portalsConfigPath } from "@/lib/career-ops";
import { getProfilePath } from "@/lib/core/profile-path.mjs";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { cachedFileValue } from "@/lib/stat-file-cache.mjs";
import { isMapping } from "@/lib/portals-config.mjs";
import { runtimePolicySnapshot } from "@/lib/runtime-policy.mjs";

function readMapping(file: string): Record<string, any> {
  return cachedFileValue(file, "runtime-policy-yaml", (text) => {
    const value = yaml.load(text);
    if (!isMapping(value)) throw new Error(`${path.basename(file)} must contain a YAML mapping`);
    return value;
  }) ?? {};
}

export async function readRuntimePolicy() {
  const root = careerOpsRoot();
  const config = readMapping(portalsConfigPath(root));
  const profile = readMapping(getProfilePath(root));
  const cv = cachedFileValue(path.join(root, "cv.md"), "runtime-cv", (text) => text) ?? "";
  // Core may live in CAREER_OPS_CODE_ROOT outside the web bundle.
  const moduleUrl = pathToFileURL(path.join(resolveCodeRoot(process.cwd(), process.env), "jd-years.mjs")).href;
  const { resolveExperienceFilter } = await import(/* webpackIgnore: true */ moduleUrl);
  const experience = resolveExperienceFilter(config.experience_filter, profile.candidate?.years_of_experience);
  return runtimePolicySnapshot(config, profile, cv, experience);
}
