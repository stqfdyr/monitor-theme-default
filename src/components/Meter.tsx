import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

type Props = { label: ReactNode; pct: number | null; foot: ReactNode }

/**
 * One metric: name and percentage on top, bar in the middle, the raw numbers
 * underneath. Greyscale carries severity as darkness (brightness in dark
 * mode), since there is no red to fall back on.
 */
export function Meter({ label, pct, foot }: Props) {
  // null means the metric has no ceiling to fill (an unmetered plan), so the
  // bar stays empty instead of claiming 0%.
  const filled = pct === null ? 0 : Math.min(100, Math.max(0, pct))
  const tone = filled >= 90 ? "bg-destructive" : filled >= 70 ? "bg-warn" : "bg-ok"
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">{label}</span>
        <span className="tnum text-xs font-medium">
          {pct === null ? "—" : `${filled < 10 ? filled.toFixed(1) : filled.toFixed(0)}%`}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-[width] duration-500", tone)} style={{ width: `${filled}%` }} />
      </div>
      <div className="tnum mt-1.5 truncate text-xs text-muted-foreground">{foot}</div>
    </div>
  )
}
