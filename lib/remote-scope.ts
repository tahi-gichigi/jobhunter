import { JobListing } from "@/types/job";
import { chatCompletion } from "./anthropic";

// Heuristic patterns that indicate country-restricted remote
const RESTRICTED_PATTERNS = [
  /\bus[- ]only\b/i,
  /\bunited states only\b/i,
  /\bmust be based in\b/i,
  /\bmust reside in\b/i,
  /\busa only\b/i,
  /\buk only\b/i,
  /\beu only\b/i,
  /\bus[-\s]based\b/i,
  /\bauthori[sz]ed to work in\b/i,
];

// Quick heuristic pass - flag obvious restrictions
function heuristicScope(job: JobListing): "global" | "country_restricted" | null {
  const text = `${job.title} ${job.location} ${job.description}`;
  for (const pattern of RESTRICTED_PATTERNS) {
    if (pattern.test(text)) return "country_restricted";
  }
  return null; // Inconclusive - needs LLM
}

// LLM classification for jobs the heuristic couldn't resolve
async function llmClassifyBatch(
  jobs: { index: number; title: string; description: string }[]
): Promise<
  { index: number; scope: "global" | "country_restricted" | "unknown"; countries: string[] }[]
> {
  const systemPrompt = `Classify each job's remote scope. Return JSON: {"results": [{"index": <number>, "scope": "global"|"country_restricted"|"unknown", "countries": ["US", ...] or []}]}. "global" = anyone worldwide. "country_restricted" = specific countries required. "unknown" = can't tell.`;

  const userPrompt = JSON.stringify(
    jobs.map((j) => ({
      index: j.index,
      title: j.title,
      desc: j.description.slice(0, 300), // Keep it concise
    }))
  );

  const raw = await chatCompletion(systemPrompt, userPrompt);
  const parsed = JSON.parse(raw);
  return parsed.results ?? [];
}

// Classify remote scope for all jobs
export async function classifyRemoteScope(
  jobs: JobListing[]
): Promise<JobListing[]> {
  const results = [...jobs];
  const needsLlm: { index: number; title: string; description: string }[] = [];

  // Pass 1: heuristic
  for (let i = 0; i < results.length; i++) {
    const scope = heuristicScope(results[i]);
    if (scope) {
      results[i] = { ...results[i], remoteScope: scope };
    } else {
      needsLlm.push({
        index: i,
        title: results[i].title,
        description: results[i].description,
      });
    }
  }

  // Pass 2: LLM for inconclusive ones
  if (needsLlm.length > 0) {
    try {
      const classified = await llmClassifyBatch(needsLlm);
      for (const item of classified) {
        if (item.index >= 0 && item.index < results.length) {
          results[item.index] = {
            ...results[item.index],
            remoteScope: item.scope,
            allowedCountries: item.countries ?? [],
          };
        }
      }
    } catch (err) {
      // LLM failed - leave as "unknown" (set during normalisation)
      console.error("Remote scope LLM classification failed:", err);
    }
  }

  return results;
}
