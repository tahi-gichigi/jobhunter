import { NextResponse } from "next/server";
import { searchAllBoards } from "@/lib/firecrawl";
import { deduplicateJobs } from "@/lib/dedup";
import { classifyRemoteScope } from "@/lib/remote-scope";
import { SearchResponse } from "@/types/job";
import { BOARDS } from "@/lib/boards";
import { PipelineLogger } from "@/lib/logger";

export async function POST() {
  const logger = new PipelineLogger();
  const startTime = Date.now();

  try {
    const { results, boardsSucceeded, boardsFailed, discoveryIncluded, creditsExhausted } =
      await searchAllBoards(logger);

    logger.log({
      stage: "post_scrape",
      rawResultCount: results.length,
    });

    // Credits exhausted with no results
    if (creditsExhausted && results.length === 0) {
      const response: SearchResponse = {
        success: false,
        results: [],
        meta: {
          totalResults: 0,
          boardsSearched: BOARDS.length + 1,
          boardsSucceeded,
          boardsFailed,
          discoveryIncluded: false,
          duplicatesRemoved: 0,
          dedupMethod: "url_only",
        },
        error: {
          code: "CREDITS_EXHAUSTED",
          message: "Search limit reached for this month.",
        },
      };
      return NextResponse.json(response, { status: 402 });
    }

    // Total failure
    if (boardsSucceeded.length === 0 && !discoveryIncluded) {
      const response: SearchResponse = {
        success: false,
        results: [],
        meta: {
          totalResults: 0,
          boardsSearched: BOARDS.length + 1,
          boardsSucceeded: [],
          boardsFailed,
          discoveryIncluded: false,
          duplicatesRemoved: 0,
          dedupMethod: "url_only",
        },
        error: {
          code: "ALL_BOARDS_FAILED",
          message: "Couldn't reach any job boards right now.",
        },
      };
      return NextResponse.json(response, { status: 502 });
    }

    // Dedup - skip LLM pass if 1 or fewer results
    let deduped = results;
    let duplicatesRemoved = 0;
    let dedupMethod: "llm" | "url_only" = "url_only";

    if (results.length > 1) {
      const dedupResult = await deduplicateJobs(results);
      deduped = dedupResult.results;
      duplicatesRemoved = dedupResult.duplicatesRemoved;
      dedupMethod = dedupResult.method;

      logger.log({
        stage: "dedup",
        rawResultCount: results.length,
        normalisedCount: deduped.length,
        droppedCount: duplicatesRemoved,
      });
    }

    // Classify remote scope - skip if no results
    let classified = deduped;
    if (deduped.length > 0) {
      classified = await classifyRemoteScope(deduped);
    }

    // Sort by date, newest first. Push "unknown" dates to the end.
    classified.sort((a, b) => {
      const aUnknown = a.datePosted === "unknown";
      const bUnknown = b.datePosted === "unknown";
      if (aUnknown && bUnknown) return 0;
      if (aUnknown) return 1;
      if (bUnknown) return -1;
      return new Date(b.datePosted).getTime() - new Date(a.datePosted).getTime();
    });

    logger.log({
      stage: "complete",
      normalisedCount: classified.length,
      durationMs: Date.now() - startTime,
    });

    const pipelineLogs = logger.flush();

    const response: SearchResponse & { _debug?: unknown } = {
      success: true,
      results: classified,
      meta: {
        totalResults: classified.length,
        boardsSearched: BOARDS.length + 1,
        boardsSucceeded,
        boardsFailed,
        discoveryIncluded,
        duplicatesRemoved,
        dedupMethod,
      },
    };

    if (process.env.NODE_ENV === "development") {
      response._debug = pipelineLogs;
    }

    return NextResponse.json(response);
  } catch (err) {
    console.error("Search route error:", err);
    logger.log({ stage: "fatal_error", error: String(err) });

    return NextResponse.json(
      {
        success: false,
        results: [],
        meta: {
          totalResults: 0,
          boardsSearched: 0,
          boardsSucceeded: [],
          boardsFailed: [],
          discoveryIncluded: false,
          duplicatesRemoved: 0,
          dedupMethod: "url_only",
        },
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred.",
        },
      },
      { status: 500 }
    );
  }
}
