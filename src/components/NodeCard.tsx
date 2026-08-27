import { ArrowDown, ArrowUp } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Meter } from "@/components/Meter"
import type { Node } from "@/lib/api"
import { bytes, daysUntil, percent, rate, uptime } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Which direction the plan meters, matching the node's traffic_mode. */
export function monthUsage(node: Node): number {
  const { month_rx: rx, month_tx: tx } = node
  switch (node.traffic_mode) {
    case "up":
      return tx
    case "down":
      return rx
    case "max":
      return Math.max(rx, tx)
    default:
      return rx + tx
  }
}

/// Online state where the price used to sit: the dot plus how long the machine
/// has been up, which is what anyone looking at a status page wants first.
export function Status({ node }: { node: Node }) {
  return (
    <Badge variant="outline" className="tnum shrink-0 gap-1.5 font-normal">
      <span className={cn("size-1.5 rounded-full", node.online ? "bg-foreground" : "bg-muted-foreground/40")} />
      {node.online ? `在线 ${node.metrics ? uptime(node.metrics.uptime) : ""}` : "离线"}
    </Badge>
  )
}

/// Traffic uses the plan's own counting rule, so the bar matches the quota the
/// node is actually billed against.
export function trafficFoot(node: Node) {
  return `${bytes(monthUsage(node))} / ${node.traffic_limit > 0 ? bytes(node.traffic_limit) : "不限"}`
}

function Expiry({ node }: { node: Node }) {
  const days = daysUntil(node.expires_at)
  if (days === null) return null
  const tone = days < 0 ? "text-destructive" : days <= 7 ? "text-warn" : "text-muted-foreground"
  return (
    <span className={tone}>
      {days < 0 ? `已过期 ${-days} 天` : `${days} 天后到期`}
    </span>
  )
}

export function NodeCard({ node, onOpen }: { node: Node; onOpen: () => void }) {
  const m = node.metrics

  return (
    <Card
      onClick={onOpen}
      className="cursor-pointer gap-0 p-5 transition-colors hover:border-ring"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium">{node.name}</h3>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {node.os || "等待上报"}
            {node.virt && node.virt !== "none" ? ` · ${node.virt}` : ""}
            {node.arch ? ` · ${node.arch}` : ""}
          </p>
        </div>
        <Status node={node} />
      </div>

      {m ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4">
            <Meter
              label="CPU"
              pct={m.cpu}
              // Load averages only mean anything against the core count, so
              // they share a line rather than getting a tile of their own.
              foot={`${m.load.map((n) => n.toFixed(2)).join(" ")} · ${node.cpu_cores || "?"} 核`}
            />
            <Meter
              label="内存"
              pct={percent(m.mem_used, m.mem_total)}
              foot={`${bytes(m.mem_used)} / ${bytes(m.mem_total)}`}
            />
            <Meter
              label="硬盘"
              pct={percent(m.disk_used, m.disk_total)}
              foot={`${bytes(m.disk_used)} / ${bytes(m.disk_total)}`}
            />
            <Meter label="流量" pct={node.traffic_limit > 0 ? percent(monthUsage(node), node.traffic_limit) : null} foot={trafficFoot(node)} />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-2 border-t pt-4 text-xs">
            <span className="tnum inline-flex items-center gap-1.5">
              <ArrowDown className="size-3 text-muted-foreground" />
              {rate(m.net_rx)}
            </span>
            <span className="tnum inline-flex items-center gap-1.5">
              <ArrowUp className="size-3 text-muted-foreground" />
              {rate(m.net_tx)}
            </span>
            <span className="tnum inline-flex items-center gap-1.5 text-muted-foreground">
              <ArrowDown className="size-3" />
              {bytes(node.total_rx)}
            </span>
            <span className="tnum inline-flex items-center gap-1.5 text-muted-foreground">
              <ArrowUp className="size-3" />
              {bytes(node.total_tx)}
            </span>
          </div>
        </>
      ) : (
        <p className="mt-6 mb-6 text-center text-sm text-muted-foreground">
          {node.last_seen ? "已离线" : "等待 agent 首次连接"}
        </p>
      )}

      {daysUntil(node.expires_at) !== null && (
        <div className="mt-3 text-right text-xs">
          <Expiry node={node} />
        </div>
      )}
    </Card>
  )
}
