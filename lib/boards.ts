import { BoardConfig } from "@/types/job";

// Keywords for UX research roles
export const UX_KEYWORDS =
  '("UX research" OR "user research" OR "UX researcher" OR "user researcher" OR "design researcher" OR "usability")';

export const BOARDS: BoardConfig[] = [
  {
    name: "Remotive",
    // Job listings live under /remote/jobs/
    siteQuery: "site:remotive.com/remote/jobs",
    layer: "curated",
  },
  {
    name: "We Work Remotely",
    // Actual job posts live under /remote-jobs/
    siteQuery: "site:weworkremotely.com/remote-jobs",
    layer: "curated",
  },
  {
    name: "Dribbble",
    // Job listings live under /jobs/ subdirectory
    siteQuery: "site:dribbble.com/jobs",
    layer: "curated",
  },
  {
    name: "User Interviews",
    // Job board lives at this specific path
    siteQuery: "site:userinterviews.com/ux-job-board",
    layer: "curated",
  },
  {
    name: "Lisbon UX",
    siteQuery: "site:jobs.lisboaux.com",
    layer: "curated",
  },
  {
    name: "UXR Hunt",
    // UX research-specific board, curated daily
    siteQuery: "site:uxrhunt.com",
    layer: "curated",
  },
  {
    name: "UI/UX Jobs Board",
    // Design jobs listings scoped to the /design-jobs path
    siteQuery: "site:uiuxjobsboard.com/design-jobs",
    layer: "curated",
  },
  {
    name: "Remote Rocketship",
    // UX researcher jobs scoped to the relevant path, scrapes company career pages
    siteQuery: "site:remoterocketship.com/us/jobs/ux-researcher",
    layer: "curated",
  },
  {
    name: "Built In",
    // Tech-focused remote design/UX jobs section
    siteQuery: "site:builtin.com/jobs/remote/design-ux",
    layer: "curated",
  },
  {
    name: "Uxcel",
    // UX-specific job board, growing listings
    siteQuery: "site:app.uxcel.com/jobs",
    layer: "curated",
  },
];

// Build a Firecrawl search query for a curated board
export function buildBoardQuery(board: BoardConfig): string {
  return `${board.siteQuery} ${UX_KEYWORDS} remote`;
}

// Build a broad discovery query (no site: scoping)
export function buildDiscoveryQuery(): string {
  return `("remote UX researcher" OR "remote UX research" OR "remote user researcher" OR "remote design researcher" OR "remote usability") jobs`;
}
