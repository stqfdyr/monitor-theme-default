import { Activity, ArrowDown, ArrowDownUp, ArrowUp, Gauge, Server } from "lucide-react"

import { Card } from "@/components/ui/card"
import type { Node } from "@/lib/api"
import { bytes, rate } from "@/lib/format"
import { cn } from "@/lib/utils"

function Tile({ icon: Icon, label, children }: {
  icon: typeof Server; label: string; children: React.ReactNode
}) {
  return (
    <Card className="gap-0 p-4">
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
        <ArrowDown className="size-3.5 shrink-0 text-muted-foreground" />
        {down}
      </span>
      <span className="inline-flex items-center gap-1">
        <ArrowUp className="size-3.5 shrink-0 text-muted-foreground" />
        {up}
      </span>
    </div>
  )
}

export function Summary({ nodes }: { nodes: Node[] }) {
  const online = nodes.filter((n) => n.online)
  const live = online.map((n) => n.metrics!).filter(Boolean)
  const sum = (pick: (n: Node) => number) => nodes.reduce((total, n) => total + pick(n), 0)

  const cpu = live.length ? live.reduce((s, m) => s + m.cpu, 0) / live.length : 0

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile icon={Server} label="节点">
        <div className="tnum mt-1.5 text-2xl font-semibold">
          {online.length} / {nodes.length}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {nodes.length - online.length > 0 ? `${nodes.length - online.length} 个离线` : "全部在线"}
        </div>
      </Tile>

      <Tile icon={Activity} label="平均 CPU">
        <div className="tnum mt-1.5 text-2xl font-semibold">{cpu.toFixed(1)}%</div>
      </Tile>

      <Tile icon={Gauge} label="实时网速">
        <Flow
          down={rate(live.reduce((s, m) => s + m.net_rx, 0))}
          up={rate(live.reduce((s, m) => s + m.net_tx, 0))}
          className="mt-1.5 text-lg font-semibold"
        />
      </Tile>

      <Tile icon={ArrowDownUp} label="今日流量">
        <Flow down={bytes(sum((n) => n.day_rx))} up={bytes(sum((n) => n.day_tx))} className="mt-1.5 text-lg font-semibold" />
        <div className="mt-3 text-xs text-muted-foreground">总流量</div>
        <Flow down={bytes(sum((n) => n.total_rx))} up={bytes(sum((n) => n.total_tx))} className="mt-1 text-sm" />
      </Tile>
    </div>
  )
}
