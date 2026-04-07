import { FirecrawlResult, JobListing } from "@/types/job";
import { parseJobDate, isWithinRecencyWindow } from "./date-utils";
import { PipelineLogger } from "./logger";

// Generate a stable ID from a URL
function hashUrl(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

// Clean up job titles - remove board names, hiring tags, etc.
function cleanTitle(title: string): string {
  return title
    .replace(/^\[hiring\]\s*/i, "")
    .replace(/\s*[-|]\s*remotive$/i, "")
    .replace(/\s*[-|]\s*dribbble$/i, "")
    .replace(/\s*[-|]\s*we work remotely$/i, "")
    .replace(/\s*[-|]\s*weworkremotely$/i, "")
    .trim();
}

// Title or URL slug must contain at least one of these to be considered
// a relevant research role. Firecrawl searches full page content so it
// returns designer roles that mention "research" in the body - this
// post-filter enforces keyword presence in the title.
const RELEVANCE_KEYWORDS = [
  /ux\s*research/i,
  /user\s*research/i,
  /ux\s*researcher/i,
  /user\s*researcher/i,
  /user\s*experience\s*research/i,
  /design\s*research/i,
  /usability/i,
  /research\s*ops/i,
  /research\s*operations/i,
  /research\s*manager/i,
  /research\s*lead/i,
  /research\s*director/i,
  /research\s*analyst/i,
];

function isTitleRelevant(result: FirecrawlResult): boolean {
  const title = result.title || "";
  // Also check URL slug (e.g. dribbble.com/jobs/296480-UX-Researcher-m-f-d)
  const urlSlug = result.url.split("/").pop()?.replace(/-/g, " ") || "";
  const text = `${title} ${urlSlug}`;
  return RELEVANCE_KEYWORDS.some((kw) => kw.test(text));
}

// URLs that are clearly not job listings
const JUNK_URL_PATTERNS = [
  /\.pdf$/i,
  /\.doc$/i,
  /wikipedia\.org/i,
  /medium\.com/i,
  /linkedin\.com\/pulse/i,
  /youtube\.com/i,
  /reddit\.com/i,
  /arxiv\.org/i,
  /scholar\.google/i,
  /news\./i,
  /blog\./i,
  /\/search\?/i,        // search result pages
  /\/search$/i,
  /\/jobs\/new$/i,       // "create a job" pages
  /\/remote-jobs\/new$/i,
];

// Title patterns that indicate non-job content
const JUNK_TITLE_PATTERNS = [
  /\[pdf\]/i,
  /how to/i,
  /what is/i,
  /guide to/i,
  /tips for/i,
  /course/i,
  /certification/i,
  /salary report/i,
  /interview questions/i,
];

function isJunkResult(result: FirecrawlResult): string | null {
  for (const p of JUNK_URL_PATTERNS) {
    if (p.test(result.url)) return `junk_url:${p.source}`;
  }
  for (const p of JUNK_TITLE_PATTERNS) {
    if (p.test(result.title || "")) return `junk_title:${p.source}`;
  }
  return null;
}

// Extract company name from title or URL
function extractCompany(result: FirecrawlResult): string {
  const title = result.title || "";

  // Remotive format: "[Hiring] Role @Company - Remotive"
  const atSymbolMatch = title.match(/@(.+?)(?:\s*[-|]|$)/);
  if (atSymbolMatch) return atSymbolMatch[1].trim();

  // "Role at Company" pattern
  const atMatch = title.match(/\bat\s+(.+?)(?:\s*[-|•·]|$)/i);
  if (atMatch) return atMatch[1].trim();

  // "Role - Company - Board" or "Role | Company"
  const parts = title.split(/\s*[-|•·]\s*/);
  if (parts.length >= 2) {
    const candidate = parts[1].trim();
    // Skip board names and generic terms
    if (
      candidate &&
      candidate.length < 50 &&
      !/remote|job|career|hire|remotive|dribbble|weworkremotely/i.test(candidate)
    ) {
      return candidate;
    }
    // Try third segment if second was the board name
    if (parts.length >= 3) {
      const alt = parts[2].trim();
      if (alt && alt.length < 50 && !/remote|job|career|hire|remotive|dribbble/i.test(alt)) {
        return alt;
      }
    }
  }

  // URL-based extraction for Remotive
  const url = result.url;
  if (/remotive\.com/.test(url)) {
    const urlMatch = url.match(/remotive\.com\/remote(?:\/jobs)?\/[^/]+\/([^/]+?)(?:-\d+)?$/);
    if (urlMatch) return urlMatch[1].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  return "Unknown";
}

// Extract the posting date - prefer Firecrawl metadata, then page content
function extractDate(result: FirecrawlResult): Date | null {
  // Priority 1: Firecrawl metadata.date
  if (result.metadata?.date) {
    const metaDate = parseJobDate(result.metadata.date);
    if (metaDate) return metaDate;
  }

  // Strip <br> tags that leak through from HTML and break date patterns
  const rawText = result.markdown || result.content || result.description || "";
  const text = rawText.replace(/<br\s*\/?>/gi, " ");

  // Priority 2: Dates with posting context words
  const contextPatterns = [
    /(?:posted|published|listed|date)\s*:?\s*(\d{4}-\d{2}-\d{2})/i,
    /(?:posted|published|listed|date)\s*:?\s*(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*(?:\s+\d{4})?)/i,
    /(?:posted|published|listed)\s*:?\s*(\d+\s*(?:d|h|w|m|min|mth|mo|day|hour|week|month)s?\s+ago)/i,
  ];

  for (const pattern of contextPatterns) {
    const match = text.match(pattern);
    if (match) {
      const parsed = parseJobDate(match[1]);
      if (parsed) return parsed;
    }
  }

  // Priority 3: Standalone relative date — search full text, date can be buried past nav/promo blocks
  // Match "3d ago", "3 days ago", "2mths ago", "2mo ago" formats
  const relativeMatch = text.match(/(\d+\s*(?:d|h|w|m|min|mth|mo|day|hour|week|month)s?\s+ago)/i);
  if (relativeMatch) {
    const parsed = parseJobDate(relativeMatch[1]);
    if (parsed) return parsed;
  }

  return null;
}

// Extract salary if mentioned
function extractSalary(result: FirecrawlResult): string | null {
  const text =
    (result.markdown || result.content || "").slice(0, 2000) + " " + (result.description || "") + " " + (result.title || "");

  // Match salary ranges ($X - $Y) or amounts with rate qualifiers (/yr, /hour, etc.)
  // Require either a range or a qualifier to avoid matching promo text like "$100 off"
  const rangeMatch = text.match(
    /\$[\d,]+(?:k)?\s*[-–]\s*\$[\d,]+(?:k)?(?:\s*(?:\/yr|\/year|\/hour|per year|per hour|annually))?/i
  );
  if (rangeMatch) return rangeMatch[0];

  const qualifiedMatch = text.match(
    /\$[\d,]+(?:k)?\s*(?:\/yr|\/year|\/hour|per year|per hour|annually)/i
  );
  if (qualifiedMatch) return qualifiedMatch[0];

  return null;
}

// Normalise a single Firecrawl result into a JobListing
export function normaliseResult(
  result: FirecrawlResult,
  boardName: string,
  layer: "curated" | "discovery"
): { job: JobListing | null; dropReason: string | null } {
  if (!result.url) return { job: null, dropReason: "no_url" };

  // Debug: log markdown length
  if (result.markdown || result.content) {
    const len = (result.markdown || result.content || "").length;
    console.log(`[${boardName}] Markdown/content length: ${len} chars for ${result.url.split("/").pop()}`);
  }

  const junkReason = isJunkResult(result);
  if (junkReason) return { job: null, dropReason: junkReason };

  if (!isTitleRelevant(result)) {
    return { job: null, dropReason: "title_irrelevant" };
  }

  const date = extractDate(result);

  if (layer === "curated") {
    // Curated boards are trusted sources. If we can't parse a date,
    // mark as "unknown" rather than dropping the result.
    if (date && !isWithinRecencyWindow(date)) {
      return { job: null, dropReason: "too_old" };
    }

    return {
      job: {
        id: hashUrl(result.url),
        title: cleanTitle(result.title || "Untitled"),
        company: extractCompany(result),
        location: "Remote",
        salary: extractSalary(result),
        datePosted: date ? date.toISOString().split("T")[0] : "unknown",
        sourceBoard: boardName,
        sourceUrl: result.url,
        description: result.description || "",
        isRemote: true,
        remoteScope: "unknown",
        allowedCountries: [],
        layer,
      },
      dropReason: null,
    };
  }

  // Discovery results: require a parseable recent date (less trusted source)
  if (!date) return { job: null, dropReason: "no_date" };
  if (!isWithinRecencyWindow(date)) return { job: null, dropReason: "too_old" };

  return {
    job: {
      id: hashUrl(result.url),
      title: cleanTitle(result.title || "Untitled"),
      company: extractCompany(result),
      location: "Remote",
      salary: extractSalary(result),
      datePosted: date.toISOString().split("T")[0],
      sourceBoard: boardName,
      sourceUrl: result.url,
      description: result.description || "",
      isRemote: true,
      remoteScope: "unknown",
      allowedCountries: [],
      layer,
    },
    dropReason: null,
  };
}

// Normalise an array with logging
export function normaliseResults(
  results: FirecrawlResult[],
  boardName: string,
  layer: "curated" | "discovery",
  logger?: PipelineLogger
): JobListing[] {
  const jobs: JobListing[] = [];
  const dropReasons: Record<string, number> = {};

  for (const r of results) {
    const { job, dropReason } = normaliseResult(r, boardName, layer);
    if (job) {
      jobs.push(job);
    } else {
      const reason = dropReason || "unknown";
      dropReasons[reason] = (dropReasons[reason] || 0) + 1;
    }
  }

  if (logger && Object.keys(dropReasons).length > 0) {
    logger.log({
      stage: "normalise_drops",
      board: boardName,
      droppedCount: results.length - jobs.length,
      droppedReasons: dropReasons,
    });
  }

  return jobs;
}
