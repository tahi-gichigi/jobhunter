import { JobListing } from "@/types/job";

export interface FilterState {
  remoteScope: "global" | "all";
  sourceBoard: string | null; // null = all boards
  dateRange: "7" | "14" | null; // days, null = no filter
  sortBy: "date" | "company";
}

export const DEFAULT_FILTERS: FilterState = {
  remoteScope: "global",
  sourceBoard: null,
  dateRange: null,
  sortBy: "date",
};

export function applyFilters(
  jobs: JobListing[],
  filters: FilterState
): JobListing[] {
  let filtered = [...jobs];

  // Date range filter
  if (filters.dateRange) {
    const days = parseInt(filters.dateRange, 10);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    filtered = filtered.filter((j) => {
      // Keep jobs with unknown dates when filtering
      if (j.datePosted === "unknown") return true;
      return new Date(j.datePosted) >= cutoff;
    });
  }

  // Sort by date (newest first), unknown dates pushed to end
  filtered.sort((a, b) => {
    const aUnknown = a.datePosted === "unknown";
    const bUnknown = b.datePosted === "unknown";
    if (aUnknown && bUnknown) return 0;
    if (aUnknown) return 1;
    if (bUnknown) return -1;
    return new Date(b.datePosted).getTime() - new Date(a.datePosted).getTime();
  });

  return filtered;
}

// Extract unique board names from results
export function getAvailableBoards(jobs: JobListing[]): string[] {
  return [...new Set(jobs.map((j) => j.sourceBoard))].sort();
}
