const RECENCY_DAYS = 14;

// Try to parse a date from various formats found in job listings
export function parseJobDate(raw: string | undefined | null): Date | null {
  if (!raw) return null;

  const text = raw.trim().toLowerCase();

  // "X days ago", "X hours ago", "3d ago", "5h ago" (full or abbreviated)
  const relativeMatch = text.match(
    /(\d+)\s*([mhdw]|min|mth|mo|minute|hour|day|week|month)s?\s+ago/
  );
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    const now = new Date();

    // Map abbreviated units to full names
    // "m" = month on job boards (posting ages are never in minutes)
    const unitMap: Record<string, string> = {
      m: "month",
      mo: "month",
      mth: "month",
      min: "minute",
      h: "hour",
      d: "day",
      w: "week",
    };
    const normalizedUnit = unitMap[unit] || unit;

    switch (normalizedUnit) {
      case "minute":
        now.setMinutes(now.getMinutes() - amount);
        return now;
      case "hour":
        now.setHours(now.getHours() - amount);
        return now;
      case "day":
        now.setDate(now.getDate() - amount);
        return now;
      case "week":
        now.setDate(now.getDate() - amount * 7);
        return now;
      case "month":
        now.setMonth(now.getMonth() - amount);
        return now;
    }
  }

  // "today" / "yesterday"
  if (text === "today") return new Date();
  if (text === "yesterday") {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d;
  }

  // Try ISO / standard date parsing
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) return parsed;

  return null;
}

// Check if a date is within the recency window
export function isWithinRecencyWindow(
  date: Date,
  days: number = RECENCY_DAYS
): boolean {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return date >= cutoff;
}

// Format a date for display as relative time or short date
export function formatRelativeDate(dateStr: string): string {
  if (dateStr === "unknown") return "Date unknown";

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "Recently";

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // Handle future dates or same-day edge cases
  if (diffDays < 0) return "Today";
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
