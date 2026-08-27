import { useEffect, useRef, useState } from "react"
import { Activity, ArrowDown, ArrowDownUp, ArrowUp, Gauge, Server } from "lucide-react"

import { Card } from "@/components/ui/card"
import type { Node } from "@/lib/api"
import { bytes, rate } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Two minutes at the hub's push interval: enough shape, no scrollback. */
const KEEP = 60

function Tile({ icon: Icon, label, children }: {
  icon: typeof Server; label: string; children: React.ReactNode
}) {
  return (
    <Card className="gap-0 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      {children}
    </Card>
  )
}

/** In and out side by side, the shape every traffic figure on this page takes. */
function Flow({ down, up, className }: { down: string; up: string; className?: string }) {
  return (
    <div className={cn("tnum grid grid-cols-2 gap-x-2", className)}>
      <span className="inline-flex items-center gap-1">
        <ArrowDown className="size-3 shrink-0 text-muted-foreground" />
        {down}
      </span>
      <span className="inline-flex items-center gap-1">
        <ArrowUp className="size-3 shrink-0 text-muted-foreground" />
        {up}
      </span>
    </div>
  )
}

/**
 * Bare polyline, no axes or tooltips: at this size a shape is all that reads,
 * and recharts would bring a chart's worth of machinery for it. Series share
 * one scale so the two throughput lines stay comparable.
 */
function Spark({ series, scale }: { series: { values: number[]; className: string }[]; scale?: number }) {
  const top = Math.max(scale ?? 0, ...series.flatMap((s) => s.values), 1)
  const width = Math.max(...series.map((s) => s.values.length), 2) - 1
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-7 w-full" aria-hidden>
      {series.map((s, i) => (
        <polyline
          key={i}
          className={s.className}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.25}
          vectorEffect="non-scaling-stroke"
          points={s.values.map((v, x) => `${(x / width) * 100},${23 - (v / top) * 22}`).join(" ")}
        />
      ))}
    </svg>
  )
}

type Sample = { rx: number; tx: number }

/// A word instead of a second chart: the percentage above already says how
/// much, so the line under it should say whether that is fine.
function pressure(cpu: number, online: number) {
  if (!online) return "无在线节点"
  if (cpu < 25) return "轻松"
  if (cpu < 60) return "正常"
  if (cpu < 85) return "压力"
  return "满载"
}

/** Samples on its own clock, so it does not re-run on every parent render. */
function useHistory(current: Sample) {
  const latest = useRef(current)
  // Updated after the render rather than during it, which is the difference
  // between a ref React is happy with and one it warns about.
  useEffect(() => {
    latest.current = current
  })
  const [history, setHistory] = useState<Sample[]>([current])
  useEffect(() => {
    const timer = setInterval(() => setHistory((h) => [...h, latest.current].slice(-KEEP)), 2000)
    return () => clearInterval(timer)
  }, [])
  return history
}

export function Summary({ nodes }: { nodes: Node[] }) {
  const online = nodes.filter((n) => n.online)
  const live = online.map((n) => n.metrics!).filter(Boolean)
  const sum = (pick: (n: Node) => number) => nodes.reduce((total, n) => total + pick(n), 0)

  // The figures come straight from the latest push; the samples only feed the
  // sparklines, so a number never lags its own chart.
  const cpu = live.length ? live.reduce((s, m) => s + m.cpu, 0) / live.length : 0
  const now = { rx: live.reduce((s, m) => s + m.net_rx, 0), tx: live.reduce((s, m) => s + m.net_tx, 0) }
  const history = useHistory(now)

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile icon={Server} label="节点">
        <div className="tnum mt-1 text-xl font-semibold">
          {online.length} / {nodes.length}
        </div>
        <div className="mt-auto pt-1 text-xs text-muted-foreground">
          {nodes.length - online.length > 0 ? `${nodes.length - online.length} 个离线` : "全部在线"}
        </div>
      </Tile>

      <Tile icon={Activity} label="平均 CPU">
        <div className="tnum mt-1 text-xl font-semibold">{cpu.toFixed(1)}%</div>
        <div className={cn("mt-auto pt-1 text-xs", cpu >= 85 ? "font-medium text-foreground" : "text-muted-foreground")}>
          {pressure(cpu, live.length)}
        </div>
      </Tile>

      <Tile icon={ArrowDownUp} label="今日流量">
        <Flow
          down={bytes(sum((n) => n.day_rx))}
          up={bytes(sum((n) => n.day_tx))}
          className="mt-1 text-sm font-semibold"
        />
        <div className="mt-2 text-xs text-muted-foreground">总流量</div>
        <Flow down={bytes(sum((n) => n.total_rx))} up={bytes(sum((n) => n.total_tx))} className="mt-0.5 text-sm" />
      </Tile>

      <Tile icon={Gauge} label="实时网速">
        <Flow down={rate(now.rx)} up={rate(now.tx)} className="mt-1 text-sm font-semibold" />
        <div className="mt-auto pt-1">
          <Spark
            series={[
              { values: history.map((s) => s.rx), className: "text-foreground" },
              { values: history.map((s) => s.tx), className: "text-muted-foreground" },
            ]}
          />
        </div>
      </Tile>
    </div>
  )
}
