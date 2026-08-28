import { useEffect, useMemo, useState } from "react"
import { median } from "d3-array"
import {
  Area, AreaChart, Brush, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"

import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Status, trafficFoot } from "@/components/NodeCard"
import { api, type Node } from "@/lib/api"
import { bytes, clock, cpuName, CYCLES, money, osName, rate } from "@/lib/format"

type Point = {
  ts: number
  cpu: number
  load1: number
  mem_used: number
  swap_used: number
  disk_used: number
  net_rx: number
  net_tx: number
}
type PingPoint = { task_id: number; ts: number; latency: number }
/** Probe names by id, sent alongside the samples they label. */
type Probes = Record<string, string>

const RANGES = [
  { hours: 1, label: "1 小时" },
  { hours: 6, label: "6 小时" },
  { hours: 24, label: "24 小时" },
  { hours: 168, label: "7 天" },
]

const AXIS = { stroke: "currentColor", fontSize: 11, tickLine: false, axisLine: false }

/// The palette is greyscale, so lightness alone runs out after two or three
/// series; the dash pattern carries the rest of the difference.
const SERIES = [
  { stroke: "var(--color-chart-1)", dash: undefined },
  { stroke: "var(--color-chart-3)", dash: "6 3" },
  { stroke: "var(--color-chart-2)", dash: "2 3" },
  { stroke: "var(--color-chart-4)", dash: "10 4 2 4" },
  { stroke: "var(--color-chart-5)", dash: "1 4" },
]

const TABS = [
  { key: "resources", label: "资源" },
  { key: "latency", label: "网络延迟" },
] as const

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-medium text-muted-foreground">{title}</h4>
      <div className="h-40 w-full text-muted-foreground">{children}</div>
    </div>
  )
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  )
}

/**
 * Hampel filter, the standard identifier for impulse noise in a time series
 * (Hampel 1974; the same thing MATLAB ships as `hampel`). A point more than
 * `sigmas` robust deviations from its window's median is an outlier and gets
 * replaced by that median — everything else is passed through untouched, which
 * is what separates it from a plain rolling median or a moving average.
 *
 * 1.4826 rescales the median absolute deviation into a standard deviation for
 * normally distributed data; 3 sigma is the usual cut.
 */
function despike(points: PingPoint[], window = 7, sigmas = 3): PingPoint[] {
  const half = window >> 1
  // ponytail: recomputes the window per point. A few thousand samples is
  // nothing; swap in a rolling structure if a chart ever needs 100k.
  return points.map((p, i) => {
    const near = points.slice(Math.max(0, i - half), i + half + 1).map((x) => x.latency)
    const mid = median(near) ?? p.latency
    const mad = median(near.map((v) => Math.abs(v - mid))) ?? 0
    const outlier = mad > 0 && Math.abs(p.latency - mid) > sigmas * 1.4826 * mad
    return outlier ? { ...p, latency: mid } : p
  })
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-3">
      <h4 className="mb-2 text-xs font-medium text-muted-foreground">{title}</h4>
      {/* One column until there is room for two: at half of a phone's 390px,
          or half of the 608px this block gets at the sm breakpoint, a CPU
          model is all ellipsis and no fact. */}
      <dl className="grid gap-x-4 gap-y-2 md:grid-cols-2">{children}</dl>
    </div>
  )
}

function Fact({ label, value }: { label: string; value?: string | number | null }) {
  if (value === null || value === undefined || value === "") return null
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm">{value}</dd>
    </div>
  )
}

export function NodeDetail({ node }: { node: Node }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("resources")
  // Each tab keeps its own range: a 7-day latency trend and a 1-hour CPU trace
  // are different questions, and switching tabs should not reset either.
  const [ranges, setRanges] = useState({ resources: 6, latency: 6 })
  const hours = ranges[tab]
  const [smooth, setSmooth] = useState(false)
  // Probes people have switched off. Hiding the slow one is what makes the
  // fast ones readable: the axis rescales to whatever is left on screen.
  const [hiddenProbes, setHiddenProbes] = useState<number[]>([])
  const [data, setData] = useState<{ metrics: Point[]; ping: PingPoint[]; probes: Probes } | null>(null)

  useEffect(() => {
    setData(null)
    api<{ metrics: Point[]; ping: PingPoint[]; probes: Probes }>(`/nodes/${node.id}/metrics?hours=${hours}`)
      .then(setData)
      .catch(() => setData({ metrics: [], ping: [], probes: {} }))
  }, [node.id, hours])

  const m = node.metrics
  // One series per probe that actually reported, labelled from the names the
  // samples arrived with — the same for a visitor as for the admin.
  // Memoised, all three of them: the node prop changes every couple of seconds
  // as live metrics arrive, and rebuilding the chart's data array on each of
  // those renders resets the brush — drag a window, let go, watch it snap back.
  const pingSeries = useMemo(
    () =>
      [...new Set((data?.ping ?? []).map((p) => p.task_id))]
        .map((id) => ({
          id,
          name: data?.probes?.[id] ?? `探测 ${id}`,
          points: (data?.ping ?? []).filter((p) => p.task_id === id && p.latency >= 0),
        }))
        .filter((s) => s.points.length > 0),
    [data],
  )

  const shownProbes = useMemo(
    () => pingSeries.filter((s) => !hiddenProbes.includes(s.id)),
    [pingSeries, hiddenProbes],
  )
  // Keyed off the full list, so a line keeps its shade when others are hidden.
  const style = (id: number) => SERIES[pingSeries.findIndex((p) => p.id === id) % SERIES.length]

  // Probes that run on different intervals rarely share a timestamp, so the
  // rows are sparse and the lines connect across the gaps.
  //
  // Every probe and both versions of every sample live in here, whether or not
  // they are on screen: recharts resets the brush the moment the data array
  // changes identity, and it re-reads a controlled selection only when the
  // index props themselves change — which they do not. So hiding a probe or
  // ticking 削峰 must not rebuild the array. They pick a `dataKey` instead, and
  // the dragged window survives both.
  const pingRows = useMemo(() => {
    const rows = new Map<number, Record<string, number>>()
    for (const s of pingSeries) {
      const smoothed = despike(s.points)
      s.points.forEach((p, i) => {
        const row = rows.get(p.ts) ?? { ts: p.ts }
        row[`t${s.id}`] = p.latency
        row[`s${s.id}`] = smoothed[i].latency
        rows.set(p.ts, row)
      })
    }
    return [...rows.values()].sort((a, b) => a.ts - b.ts)
  }, [pingSeries])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="truncate text-lg font-medium">{node.name}</h2>
        <Status node={node} />
        {node.agent_version && (
          <Badge variant="outline" className="font-normal">
            agent {node.agent_version}
          </Badge>
        )}
      </div>

      {/* Two groups of four. Every line that only restated another one is
          gone: uptime is already in the badge above, and the kernel, the
          virtualisation and the process count now ride along with the fact
          they belong to. */}
      {/* Side by side only once there is room for two facts per row inside
          each of them: at 1024px that works out to 230px a fact, which is a
          kernel version with its tail cut off. */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Group title="机器">
          <Fact label="系统" value={[osName(node.os), node.kernel].filter(Boolean).join(" · ")} />
          <Fact
            label="CPU"
            value={node.cpu_name ? `${cpuName(node.cpu_name)} × ${node.cpu_cores}` : `${node.cpu_cores} 核`}
          />
          <Fact label="内存 / 硬盘" value={`${bytes(node.mem_total)} / ${bytes(node.disk_total)}`} />
          <Fact
            label="架构"
            value={[node.arch, node.virt !== "none" ? node.virt : "", m ? `${m.procs} 进程` : ""]
              .filter(Boolean)
              .join(" · ")}
          />
        </Group>
        <Group title="流量与续费">
          <Fact label="今日" value={`↓ ${bytes(node.day_rx)} · ↑ ${bytes(node.day_tx)}`} />
          <Fact label="本月" value={trafficFoot(node)} />
          <Fact label="累计" value={`↓ ${bytes(node.total_rx)} · ↑ ${bytes(node.total_tx)}`} />
          <Fact
            label="续费"
            value={
              node.price > 0
                ? `${money(node.price, node.currency)} / ${CYCLES[node.billing_cycle] ?? node.billing_cycle}${
                    node.expires_at ? ` · ${node.expires_at} 到期` : ""
                  }`
                : node.expires_at && `${node.expires_at} 到期`
            }
          />
        </Group>
      </div>

      {node.remark && (
        <p className="rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-wrap">{node.remark}</p>
      )}

      <div className="space-y-2 border-t pt-4">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <Tab key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>
              {t.label}
            </Tab>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <Tab
                key={r.hours}
                active={hours === r.hours}
                onClick={() => setRanges((all) => ({ ...all, [tab]: r.hours }))}
              >
                {r.label}
              </Tab>
            ))}
          </div>
          {tab === "latency" && (
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={smooth}
                onChange={(e) => setSmooth(e.target.checked)}
                className="accent-foreground"
              />
              削峰
            </label>
          )}
        </div>
      </div>

      {!data ? (
        <Skeleton className="h-40 w-full" />
      ) : tab === "latency" ? (
        pingSeries.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">这段时间没有延迟数据</p>
        ) : (
          <div className="space-y-3">
            {/* A measured height, not flex-1: ResponsiveContainer reads its
                parent's height, and inside a min-height flex chain that first
                read can come back 0 — which draws nothing at all. Viewport
                minus what sits above it, so the chart still ends at the fold. */}
            <div className="h-[calc(100svh-26rem)] min-h-72 w-full text-muted-foreground">
              {shownProbes.length === 0 ? (
                <p className="py-8 text-center text-sm">没有选中任何探测</p>
              ) : (
                <ResponsiveContainer>
                  <LineChart data={pingRows}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                    <XAxis dataKey="ts" tickFormatter={clock} {...AXIS} minTickGap={40} />
                    {/* Not anchored at zero: these lines live in a narrow band far
                        from it, and starting at zero flattens every wobble. */}
                    <YAxis unit="ms" width={52} domain={["auto", "auto"]} {...AXIS} />
                    <Tooltip
                      labelFormatter={(ts) => new Date(Number(ts) * 1000).toLocaleString("zh-CN")}
                      formatter={(v) => `${Number(v)} ms`}
                      contentStyle={{ fontSize: 12 }}
                    />
                    {shownProbes.map((s) => (
                      <Line
                        key={s.id}
                        dataKey={`${smooth ? "s" : "t"}${s.id}`}
                        name={s.name}
                        stroke={style(s.id).stroke}
                        strokeDasharray={style(s.id).dash}
                        strokeWidth={1.5}
                        dot={false}
                        connectNulls
                      />
                    ))}
                    {/* Drag either handle to zoom into a stretch of the trend. */}
                    <Brush
                      dataKey="ts"
                      height={22}
                      travellerWidth={8}
                      tickFormatter={clock}
                      className="fill-muted"
                      stroke="var(--color-muted-foreground)"
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Under the chart rather than above it: what the chart covers
                is picked at the top, what is drawn in it is picked here.
                Recharts paints the brush into the same SVG as the axis, so
                this is as close beneath it as HTML can sit. */}
            {pingSeries.length > 1 && (
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {pingSeries.map((s) => {
                const shown = !hiddenProbes.includes(s.id)
                return (
                  <button
                    key={s.id}
                    onClick={() =>
                      setHiddenProbes((h) => (shown ? [...h, s.id] : h.filter((id) => id !== s.id)))
                    }
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-opacity ${
                      shown ? "" : "opacity-40"
                    }`}
                  >
                    {/* The swatch carries the same shade and dash as the line. */}
                    <svg width="14" height="6" className="shrink-0" aria-hidden>
                      <line
                        x1="0"
                        y1="3"
                        x2="14"
                        y2="3"
                        stroke={style(s.id).stroke}
                        strokeDasharray={style(s.id).dash}
                        strokeWidth="2"
                      />
                    </svg>
                    {s.name}
                  </button>
                )
              })}
            </div>
            )}
          </div>
        )
      ) : data.metrics.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">这段时间没有历史数据</p>
      ) : (
        <div className="space-y-5">
          <Panel title="CPU 与负载">
            <ResponsiveContainer>
              <AreaChart data={data.metrics}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis dataKey="ts" tickFormatter={clock} {...AXIS} minTickGap={40} />
                <YAxis domain={[0, 100]} unit="%" width={40} {...AXIS} />
                <Tooltip
                  labelFormatter={(ts) => new Date(Number(ts) * 1000).toLocaleString("zh-CN")}
                  formatter={(v, name) => [name === "cpu" ? `${Number(v).toFixed(1)}%` : Number(v).toFixed(2), name === "cpu" ? "CPU" : "负载"]}
                  contentStyle={{ fontSize: 12 }}
                />
                <Area dataKey="cpu" stroke="var(--color-chart-1)" fill="var(--color-chart-1)" fillOpacity={0.15} strokeWidth={1.5} dot={false} />
                <Area dataKey="load1" stroke="var(--color-chart-3)" fill="none" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title="内存">
            <ResponsiveContainer>
              <AreaChart data={data.metrics}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis dataKey="ts" tickFormatter={clock} {...AXIS} minTickGap={40} />
                <YAxis tickFormatter={(v) => bytes(v, 0)} width={62} {...AXIS} />
                <Tooltip
                  labelFormatter={(ts) => new Date(Number(ts) * 1000).toLocaleString("zh-CN")}
                  formatter={(v) => bytes(Number(v))}
                  contentStyle={{ fontSize: 12 }}
                />
                <Area dataKey="mem_used" name="内存" stroke="var(--color-chart-2)" fill="var(--color-chart-2)" fillOpacity={0.15} strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title="网络速率">
            <ResponsiveContainer>
              <LineChart data={data.metrics}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis dataKey="ts" tickFormatter={clock} {...AXIS} minTickGap={40} />
                <YAxis tickFormatter={(v) => bytes(v, 0)} width={62} {...AXIS} />
                <Tooltip
                  labelFormatter={(ts) => new Date(Number(ts) * 1000).toLocaleString("zh-CN")}
                  formatter={(v) => rate(Number(v))}
                  contentStyle={{ fontSize: 12 }}
                />
                <Line dataKey="net_rx" name="下行" stroke="var(--color-ok)" strokeWidth={1.5} dot={false} />
                <Line dataKey="net_tx" name="上行" stroke="var(--color-chart-1)" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </Panel>

        </div>
      )}
    </div>
  )
}
