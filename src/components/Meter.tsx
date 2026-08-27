import type { ReactNode } from "react"

type Props = { label: ReactNode; pct: number | null; foot: ReactNode }

/**
 * One metric: name and percentage on top, bar in the middle, the raw numbers
 * underneath. Black on the light theme, white on the dark one — the length of
 * the bar is the whole message, and shading it by severity only muddied it.
 */
export function Meter({ label, pct, foot }: Props) {
  // null means the metric has no ceiling to fill (an unmetered plan), so the
  // bar stays empty instead of claiming 0%.
  const filled = pct === null ? 0 : Math.min(100, Math.max(0, pct))
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">{label}</span>
        <span className="tnum text-xs font-medium">
          {pct === null ? "—" : `${filled < 10 ? filled.toFixed(1) : filled.toFixed(0)}%`}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-foreground transition-[width] duration-500" style={{ width: `${filled}%` }} />
      </div>
      <div className="tnum mt-1.5 truncate text-xs text-muted-foreground">{foot}</div>
    </div>
  )
}
