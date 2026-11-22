export type WorkplaceType = "remote" | "hybrid" | "onsite" | "unknown";
export type JobEligibility = "eligible" | "restricted" | "unknown";

/** Publication, source updates and our observations are independent facts. */
export type CatalogJob = {
  id: string;
  url: string;
  company: string;
  role: string;
  location?: string;
  compensation?: string;
  postedAt?: string;
  sourceUpdatedAt?: string;
  firstSeenAt?: string;
  lastSeenAt?: string;
  closesAt?: string;
  postingStatus?: "open" | "closed" | "unknown";
  workplaceType?: WorkplaceType;
  eligibility?: JobEligibility;
  eligibilityReason?: string;
  geographyEvidence?: unknown;
  yrs?: string;
  note?: string;
  source: string;
  evaluatedScore?: string;
  trackerStatus?: string;
  isEvaluated?: boolean;
};
