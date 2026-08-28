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

/// A node that has reported even once told the hub its shape — cores, memory,
/// disk — and the hub keeps its traffic totals whether or not it is connected.
/// A node that never connected has none of that, and is the only case with
/// nothing to show.
export function deployed(node: Node) {
  return node.cpu_cores > 0 || node.mem_total > 0
}

/// Online state where the price used to sit: the dot plus how long the machine
/// has been up, which is what anyone looking at a status page wants first.
export function Status({ node }: { node: Node }) {
  const label = node.online ? `在线 ${node.metrics ? uptime(node.metrics.uptime) : ""}` : deployed(node) ? "离线" : "未接入"
  return (
    <Badge variant="outline" className="tnum shrink-0 gap-1.5 font-normal">
      <span className={cn("size-1.5 rounded-full", node.online ? "bg-foreground" : "bg-muted-foreground/40")} />
      {label}
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
    <span className={cn("tnum text-xs", tone)}>
      {days < 0 ? `已过期 ${-days} 天` : `${days} 天后到期`}
    </span>
  )
}

export function NodeCard({ node, onOpen }: { node: Node; onOpen: () => void }) {
  const m = node.metrics

  return (
    <Card
      onClick={onOpen}
      // min-w-0: a grid item sizes to its content unless told otherwise, and
      // the OS line below does not wrap — so on a phone the card grew past the
      // column and took the whole page into a sideways scroll. The truncate
      // inside only works once the card itself is allowed to be narrower.
      className="min-w-0 cursor-pointer gap-0 p-5 transition-colors hover:border-ring"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium">{node.name}</h3>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {node.os || "等待首次上报"}
            {node.virt && node.virt !== "none" ? ` · ${node.virt}` : ""}
            {node.arch ? ` · ${node.arch}` : ""}
          </p>
        </div>
        {/* State on the right, identity on the left, one line each: the expiry
            used to hang alone under the card, right-aligned against nothing. */}
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Status node={node} />
          <Expiry node={node} />
        </div>
      </div>

      {/* One layout for both states. A disconnected node still knows its cores,
          its memory and disk size, and its traffic totals — showing those with
          the live figures left blank beats a stretched card with one line of
          apology floating in the middle of it. */}
      {deployed(node) ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4">
            <Meter
              label="CPU"
              pct={m ? m.cpu : null}
              // Load averages only mean anything against the core count, so
              // they share a line rather than getting a tile of their own.
              foot={m ? `${m.load.map((n) => n.toFixed(2)).join(" ")} · ${node.cpu_cores} 核` : `${node.cpu_cores} 核`}
            />
            <Meter
              label="内存"
              pct={m ? percent(m.mem_used, m.mem_total) : null}
              foot={m ? `${bytes(m.mem_used)} / ${bytes(m.mem_total)}` : bytes(node.mem_total)}
            />
            <Meter
              label="硬盘"
              pct={m ? percent(m.disk_used, m.disk_total) : null}
              foot={m ? `${bytes(m.disk_used)} / ${bytes(m.disk_total)}` : bytes(node.disk_total)}
            />
            <Meter label="流量" pct={node.traffic_limit > 0 ? percent(monthUsage(node), node.traffic_limit) : null} foot={trafficFoot(node)} />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-2 border-t pt-4 text-xs">
            <span className="tnum inline-flex items-center gap-1.5">
              <ArrowDown className="size-3 text-muted-foreground" />
              {m ? rate(m.net_rx) : "—"}
            </span>
            <span className="tnum inline-flex items-center gap-1.5">
              <ArrowUp className="size-3 text-muted-foreground" />
              {m ? rate(m.net_tx) : "—"}
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
        /* Never connected: there is genuinely nothing to plot, so the card stays
           short rather than padding itself out to match its neighbours. */
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          还没有接入。在后台生成安装命令，在这台机器上执行一次即可。
        </p>
      )}
    </Card>
  )
}
