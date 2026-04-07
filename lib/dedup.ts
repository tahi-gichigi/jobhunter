import { JobListing } from "@/types/job";
import { chatCompletion } from "./anthropic";

interface DedupGroup {
  keep: number;
  discard: number[];
}

interface DedupResponse {
  groups: DedupGroup[];
}

// URL-based dedup as a cheap first pass
function urlDedup(jobs: JobListing[]): {
  unique: JobListing[];
  removed: number;
} {
  const seen = new Set<string>();
  const unique = jobs.filter((job) => {
    const key = job.sourceUrl.replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { unique, removed: jobs.length - unique.length };
}

// LLM dedup pass - groups listings that are the same role at the same company
async function llmDedup(jobs: JobListing[]): Promise<{
  deduped: JobListing[];
  removed: number;
}> {
  // Build a compact representation for the LLM
  const summaries = jobs.map((j, i) => ({
    i,
    title: j.title,
    company: j.company,
    url: j.sourceUrl,
    board: j.sourceBoard,
  }));

  const systemPrompt = `You identify duplicate job listings. Two listings are duplicates if they are the same role at the same company, even if found on different job boards. Return JSON with a "groups" array. Each group has "keep" (index of the listing with the most info) and "discard" (array of duplicate indices to remove). Only include groups where duplicates exist.`;

  const userPrompt = JSON.stringify(summaries);
  const raw = await chatCompletion(systemPrompt, userPrompt);
  const parsed: DedupResponse = JSON.parse(raw);

  // Validate the response
  if (!Array.isArray(parsed.groups)) {
    throw new Error("Invalid dedup response");
  }

  const discardSet = new Set<number>();
  for (const group of parsed.groups) {
    if (
      typeof group.keep !== "number" ||
      !Array.isArray(group.discard) ||
      group.keep < 0 ||
      group.keep >= jobs.length
    ) {
      continue; // Skip invalid groups
    }
    for (const idx of group.discard) {
      if (typeof idx === "number" && idx >= 0 && idx < jobs.length && idx !== group.keep) {
        discardSet.add(idx);
      }
    }
  }

  const deduped = jobs.filter((_, i) => !discardSet.has(i));
  return { deduped, removed: discardSet.size };
}

// Full dedup pipeline: URL match first, then LLM pass with fallback
export async function deduplicateJobs(jobs: JobListing[]): Promise<{
  results: JobListing[];
  duplicatesRemoved: number;
  method: "llm" | "url_only";
}> {
  // Step 1: URL dedup
  const { unique: urlUnique, removed: urlRemoved } = urlDedup(jobs);

  // Step 2: LLM dedup (with fallback to URL-only)
  try {
    const { deduped, removed: llmRemoved } = await llmDedup(urlUnique);
    return {
      results: deduped,
      duplicatesRemoved: urlRemoved + llmRemoved,
      method: "llm",
    };
  } catch (err) {
    console.error("LLM dedup failed, falling back to URL-only:", err);
    return {
      results: urlUnique,
      duplicatesRemoved: urlRemoved,
      method: "url_only",
    };
  }
}
