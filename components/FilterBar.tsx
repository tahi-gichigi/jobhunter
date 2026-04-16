"use client";

import { FilterState } from "@/lib/filters";

interface FilterBarProps {
  filters: FilterState;
  boards: string[];
  onFilterChange: <K extends keyof FilterState>(
    key: K,
    value: FilterState[K]
  ) => void;
  totalCount: number;
  filteredCount: number;
}

export default function FilterBar({
  filters,
  boards,
  onFilterChange,
  totalCount,
  filteredCount,
}: FilterBarProps) {
  return (
    <div className="mb-6">
      <div className="flex flex-wrap gap-2">
        {/* Date range filter */}
        <select
          value={filters.dateRange ?? ""}
          onChange={(e) =>
            onFilterChange(
              "dateRange",
              (e.target.value as "7" | "14") || null
            )
          }
          className="text-sm border border-gray-200 rounded px-2 py-1"
        >
          <option value="">Any date</option>
          <option value="7">Last 7 days</option>
          <option value="14">Last 14 days</option>
        </select>
      </div>
    </div>
  );
}
