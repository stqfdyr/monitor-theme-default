import { ArrowDown, ArrowUp } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Meter } from "@/components/Meter"
import type { Node } from "@/lib/api"
import { bytes, daysUntil, FOREVER, osName, percent, rate, uptime } from "@/lib/format"
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
/// has been up — or, once it has gone, how long it has been gone, which is the
/// first thing anyone asks of an offline node. Both are durations, so the badge
/// keeps its shape either way.
export function Status({ node }: { node: Node }) {
  const down = node.last_seen ? Date.now() / 1000 - node.last_seen : 0
  const label = node.online
    ? `在线 ${node.metrics ? uptime(node.metrics.uptime) : ""}`
    : deployed(node)
      ? `离线 ${down >= 60 ? uptime(down) : ""}`
      : "未接入"
  return (
    // Muted once it is not reporting: the page still shows real figures, they
    // are just no longer current, and that is what the badge has to say.
    <Badge
      variant="outline"
      className={cn("tnum shrink-0 gap-1.5 font-normal", !node.online && "text-muted-foreground")}
    >
      <span className={cn("size-1.5 rounded-full", node.online ? "bg-foreground" : "bg-muted-foreground/40")} />
      {label.trim()}
    </Badge>
  )
}

/// Traffic uses the plan's own counting rule, so the bar matches the quota the
/// node is actually billed against.
export function trafficFoot(node: Node) {
  return `${bytes(monthUsage(node))} / ${node.traffic_limit > 0 ? bytes(node.traffic_limit) : FOREVER}`
}

/// No date means nothing ever expires — a permanent box, or one nobody set a
/// renewal for. The symbol says that; a blank corner said nothing.
function Expiry({ node }: { node: Node }) {
  const days = daysUntil(node.expires_at)
  if (days === null) return <span className="text-xs text-muted-foreground" title="永不到期">{FOREVER}</span>
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
            {node.os ? osName(node.os) : "等待首次上报"}
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
            {/* The core count belongs beside the word CPU, not trailing the
                load averages: it is what the percentage and the three numbers
                below it are both measured against. */}
            <Meter
              label={`CPU ${node.cpu_cores} 核`}
              pct={m ? m.cpu : null}
              foot={m ? m.load.map((n) => n.toFixed(2)).join(" ") : "—"}
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
            <Meter
              label="流量"
              pct={node.traffic_limit > 0 ? percent(monthUsage(node), node.traffic_limit) : null}
              empty={FOREVER}
              foot={trafficFoot(node)}
            />
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
          还没有接入。在后台生成安装命令并执行一次。
        </p>
      )}
    </Card>
  )
}
