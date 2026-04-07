import { BoardConfig, FirecrawlResponse, FirecrawlResult, JobListing } from "@/types/job";
import { buildBoardQuery, buildDiscoveryQuery, BOARDS } from "./boards";
import { normaliseResults } from "./normalise";
import { PipelineLogger } from "./logger";

const FIRECRAWL_URL = "https://api.firecrawl.dev/v2/search";

// Extract results from Firecrawl response, handling both response shapes
function extractResults(data: FirecrawlResponse): FirecrawlResult[] {
  if (data.data?.web?.length) return data.data.web;
  if (data.results?.length) return data.results;
  return [];
}

// Make a single Firecrawl search request
async function firecrawlSearch(
  query: string,
  label: string,
  logger: PipelineLogger,
  limit: number = 20
): Promise<FirecrawlResult[]> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY not configured");

  const body = {
    query,
    limit,
    timeout: 60000,
    sources: [{ type: "web" }],
    scrapeOptions: {
      formats: ["markdown"],
      onlyMainContent: true,
      // Strip noise that bloats markdown and buries dates:
      // modals/banners (Remotive paywall), images, boilerplate tags
      excludeTags: [
        "nav", "header", "footer", "script", "style", "img", "svg", "picture",
        "[class*='modal']", "[class*='banner']", "[class*='promo']",
        "[class*='popup']", "[class*='overlay']",
      ],
      removeBase64Images: true,
    },
  };

  logger.log({ stage: "firecrawl_request", board: label, query });

  const start = Date.now();

  const doFetch = () =>
    fetch(FIRECRAWL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

  let response = await doFetch();

  if (response.status === 429) {
    logger.log({ stage: "firecrawl_retry", board: label });
    await new Promise((r) => setTimeout(r, 2000));
    response = await doFetch();
  }

  if (response.status === 402) throw new Error("CREDITS_EXHAUSTED");
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    logger.log({
      stage: "firecrawl_error",
      board: label,
      error: `HTTP ${response.status}: ${errorBody.slice(0, 200)}`,
    });
    throw new Error(`Firecrawl ${response.status}`);
  }

  const data: FirecrawlResponse = await response.json();
  const webResults = extractResults(data);

  logger.log({
    stage: "firecrawl_response",
    board: label,
    rawResultCount: webResults.length,
    durationMs: Date.now() - start,
    sampleResults: [
      {
        _responseKeys: Object.keys(data),
        _hasDataWeb: !!data.data?.web,
        _hasResults: !!data.results,
        _firstResult: webResults[0]
          ? {
              url: webResults[0].url,
              title: webResults[0].title,
              description: webResults[0].description?.slice(0, 150),
              markdownPreview: (webResults[0].markdown || webResults[0].content || "").slice(0, 400),
              metadataDate: webResults[0].metadata?.date,
            }
          : null,
      },
    ],
  });

  return webResults;
}

// Search a single board
export async function searchBoard(
  board: BoardConfig,
  logger: PipelineLogger
): Promise<JobListing[]> {
  const query = buildBoardQuery(board);
  const raw = await firecrawlSearch(query, board.name, logger, 10); // Reduced from 20 to control scraping cost
  const normalised = normaliseResults(raw, board.name, board.layer, logger);

  logger.log({
    stage: "normalise",
    board: board.name,
    rawResultCount: raw.length,
    normalisedCount: normalised.length,
    droppedCount: raw.length - normalised.length,
  });

  return normalised;
}

// Search all boards + discovery in parallel
export async function searchAllBoards(logger: PipelineLogger): Promise<{
  results: JobListing[];
  boardsSucceeded: string[];
  boardsFailed: string[];
  discoveryIncluded: boolean;
  creditsExhausted: boolean;
}> {
  const boardsSucceeded: string[] = [];
  const boardsFailed: string[] = [];
  let discoveryIncluded = false;
  let creditsExhausted = false;
  const allResults: JobListing[] = [];

  const boardPromises = BOARDS.map(async (board) => {
    try {
      const results = await searchBoard(board, logger);
      return { board: board.name, results, error: null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.log({ stage: "board_error", board: board.name, error: msg });
      return { board: board.name, results: [] as JobListing[], error: msg };
    }
  });

  const discoveryPromise = (async () => {
    try {
      const query = buildDiscoveryQuery();
      const raw = await firecrawlSearch(query, "Discovery", logger, 10); // Reduced from 20
      const results = normaliseResults(raw, "Discovery", "discovery", logger);

      logger.log({
        stage: "normalise",
        board: "Discovery",
        rawResultCount: raw.length,
        normalisedCount: results.length,
        droppedCount: raw.length - results.length,
      });

      return { board: "Discovery", results, error: null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.log({ stage: "board_error", board: "Discovery", error: msg });
      return { board: "Discovery", results: [] as JobListing[], error: msg };
    }
  })();

  const settled = await Promise.all([...boardPromises, discoveryPromise]);

  for (const result of settled) {
    if (result.error === "CREDITS_EXHAUSTED") {
      creditsExhausted = true;
      boardsFailed.push(result.board);
      continue;
    }

    if (result.error) {
      boardsFailed.push(result.board);
      continue;
    }

    if (result.board === "Discovery") {
      discoveryIncluded = true;
    } else {
      boardsSucceeded.push(result.board);
    }
    allResults.push(...result.results);
  }

  logger.log({
    stage: "aggregate",
    rawResultCount: allResults.length,
  });

  return { results: allResults, boardsSucceeded, boardsFailed, discoveryIncluded, creditsExhausted };
}
