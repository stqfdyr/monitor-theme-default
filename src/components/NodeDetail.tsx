import { useEffect, useMemo, useState } from "react"
import { median } from "d3-array"
import {
  Area, AreaChart, Brush, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"

import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Status } from "@/components/NodeCard"
import { api, type Node } from "@/lib/api"
import {
  axisBytes, bytes, clockFor, cpuName, CYCLES, FOREVER, money, osName, rate, timeTicks,
} from "@/lib/format"

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
/// `latency` is the bucket's mean round trip and is null when every probe in
/// it timed out; `loss` is the percentage that did, and is absent when none did.
type PingPoint = { task_id: number; ts: number; latency: number | null; loss?: number }
/** Probe names by id, sent alongside the samples they label. */
type Probes = Record<string, string>

const RANGES = [
  { hours: 1, label: "1 小时" },
  { hours: 6, label: "6 小时" },
  { hours: 24, label: "24 小时" },
  { hours: 168, label: "7 天" },
]

/// Latency stops at a day: a week of it is one line per probe drawn through
/// samples a day already shows the shape of.
const RANGES_FOR = { resources: RANGES, latency: RANGES.filter((r) => r.hours <= 24) }

const AXIS = { stroke: "currentColor", fontSize: 11, tickLine: false, axisLine: false }

/// No grow-in animation. It is 1.5 s of a line crawling across the panel every
/// time a range button is pressed, on a page whose whole job is to be read at a
/// glance -- and on the latency chart it is that animation run over seven
/// hundred points a probe. Nothing else here animates either.
const SERIES = { dot: false as const, strokeWidth: 1.5, isAnimationActive: false }

/// One width for every stacked panel's value axis. They used to size to their
/// own labels — 40px under "100%", 68px under "172 MB" — which slid the four
/// plot areas 28px out of line with each other, so a CPU spike and the network
/// spike that caused it sat at different x and the axes disagreed about when
/// either happened.
const Y_WIDTH = 68

/// The palette is greyscale, so lightness alone runs out after two or three
/// series; the dash pattern carries the rest of the difference.
const PALETTE = [
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
    // A timeout is a hole, not a tall reading: it neither gets smoothed nor
    // counts towards what its neighbours are compared against.
    if (p.latency === null) return p
    const near = points
      .slice(Math.max(0, i - half), i + half + 1)
      .map((x) => x.latency)
      .filter((v) => v !== null)
    const mid = median(near) ?? p.latency
    const mad = median(near.map((v) => Math.abs(v - mid))) ?? 0
    const outlier = mad > 0 && Math.abs(p.latency - mid) > sigmas * 1.4826 * mad
    return outlier ? { ...p, latency: mid } : p
  })
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
  // What the brush has been dragged to, so the axis can retick for the stretch
  // actually on screen instead of keeping the ticks of the whole window.
  const [zoom, setWindow] = useState<[number, number] | null>(null)

  useEffect(() => {
    // Blanking first is the point: the charts must not keep drawing the
    // old range while the new one is in flight.
    // oxlint-disable-next-line react/set-state-in-effect
    setData(null)
    // oxlint-disable-next-line react/set-state-in-effect
    setWindow(null)
    // What this screen can actually draw, the way a Grafana panel sends its
    // own width. Read here rather than off a ref: the hub only ever thins
    // further, so a rough figure is enough, and the viewport is known before
    // the chart has been laid out. A rotation keeps whatever it fetched with.
    const points = Math.round(globalThis.innerWidth)
    api<{ metrics: Point[]; ping: PingPoint[]; probes: Probes }>(
      `/nodes/${node.id}/metrics?hours=${hours}&points=${points}`,
    )
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
        .map((id) => {
          // Timeouts stay in: dropping them is what let a probe losing half
          // its packets draw as an unbroken healthy line, and a probe that
          // answered nothing at all disappear from the chart entirely.
          const points = (data?.ping ?? []).filter((p) => p.task_id === id)
          const loss = points.reduce((sum, p) => sum + (p.loss ?? 0), 0) / (points.length || 1)
          return { id, name: data?.probes?.[id] ?? `探测 ${id}`, points, loss: Math.round(loss) }
        })
        .filter((s) => s.points.length > 0),
    [data],
  )

  // The hub answers in seconds; the time axis wants milliseconds. Memoised for
  // the same reason as the rows below -- a new array identity resets the brush.
  const metricRows = useMemo(
    () => (data?.metrics ?? []).map((m) => ({ ...m, ts: m.ts * 1_000 })),
    [data],
  )

  const shownProbes = useMemo(
    () => pingSeries.filter((s) => !hiddenProbes.includes(s.id)),
    [pingSeries, hiddenProbes],
  )
  // Keyed off the full list, so a line keeps its shade when others are hidden.
  const style = (id: number) => PALETTE[pingSeries.findIndex((p) => p.id === id) % PALETTE.length]

  // The hub stamps every sample with its bucket rather than with the second
  // the probe happened to finish on, so probes reporting at the bucket's rate
  // share rows instead of each bringing its own timestamps -- a day of four
  // probes is 717 rows here, not 2 868. A probe slower than the bucket still
  // leaves holes in its own column, which is what `connectNulls` is for.
  //
  // Every probe and both versions of every sample live in here, whether or not
  // they are on screen: recharts resets the brush the moment the data array
  // changes identity, and it re-reads a controlled selection only when the
  // index props themselves change — which they do not. So hiding a probe or
  // ticking 削峰 must not rebuild the array. They pick a `dataKey` instead, and
  // the dragged window survives both.
  const pingRows = useMemo(() => {
    const rows = new Map<number, { ts: number } & Record<string, number | null>>()
    for (const s of pingSeries) {
      const smoothed = despike(s.points)
      s.points.forEach((p, i) => {
        const row = rows.get(p.ts) ?? { ts: p.ts * 1_000 }
        row[`t${s.id}`] = p.latency
        row[`s${s.id}`] = smoothed[i].latency
        row[`l${s.id}`] = p.loss ?? 0
        rows.set(p.ts, row)
      })
    }
    return [...rows.values()].sort((a, b) => a.ts - b.ts)
  }, [pingSeries])

  // A real time axis, not the category one recharts defaults to. On a category
  // axis the ticks are picked by index, so a stretch the agent was offline for
  // closes up to nothing and the labels stop meaning what they say. `scale=time`
  // also puts the ticks on round clock values instead of on whatever sample
  // happened to land at every eleventh index.
  const timeAxis = (rows: { ts: number }[], from = 0, to = rows.length - 1) => ({
    dataKey: "ts",
    type: "number" as const,
    domain: ["dataMin", "dataMax"] as const,
    // Explicit, because recharts would otherwise land them on 05:14 and 10:22.
    // Any that still collide are dropped by `minTickGap`, which is what keeps
    // the same axis readable on a phone and on a wide screen.
    ticks: rows.length ? timeTicks(rows[from].ts, rows[to].ts) : undefined,
    tickFormatter: clockFor(hours),
    minTickGap: hours > 24 ? 72 : 40,
    ...AXIS,
  })

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

      {/* One flat row of facts. Two bordered groups earned their boxes while
          half the facts were traffic figures; what is left is one machine's
          spec sheet, and a box around a single topic is just a box. Three
          across at lg, two at md, one on a phone — a kernel version or a CPU
          model needs about 270px to stay whole. */}
      <dl className="grid gap-x-6 gap-y-3 md:grid-cols-2 lg:grid-cols-3">
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
        <Fact label="今日流量" value={`↓ ${bytes(node.day_rx)} · ↑ ${bytes(node.day_tx)}`} />
        <Fact
          label="续费"
          value={[
            node.price > 0
              ? `${money(node.price, node.currency)} / ${CYCLES[node.billing_cycle] ?? node.billing_cycle}`
              : "免费",
            node.expires_at ? `${node.expires_at} 到期` : FOREVER,
          ].join(" · ")}
        />
      </dl>

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
            {RANGES_FOR[tab].map((r) => (
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
                    <XAxis
                      {...timeAxis(
                        pingRows,
                        Math.min(zoom?.[0] ?? 0, pingRows.length - 1),
                        Math.min(zoom?.[1] ?? pingRows.length - 1, pingRows.length - 1),
                      )}
                    />
                    {/* Not anchored at zero: these lines live in a narrow band far
                        from it, and starting at zero flattens every wobble. */}
                    <YAxis unit="ms" width={52} domain={["auto", "auto"]} {...AXIS} />
                    <Tooltip
                      labelFormatter={(ts) => new Date(Number(ts)).toLocaleString("zh-CN")}
                      // The line is drawn from what answered, so without this a
                      // bucket that lost most of its packets reads as a normal
                      // reading. `dataKey` is `t7`/`s7`; the loss sits at `l7`.
                      formatter={(v, name, item) => {
                        const loss = Number(item?.payload?.[`l${String(item.dataKey).slice(1)}`] ?? 0)
                        return [`${Number(v)} ms${loss > 0 ? ` · 丢 ${loss}%` : ""}`, name]
                      }}
                      contentStyle={{ fontSize: 12 }}
                    />
                    {shownProbes.map((s) => (
                      <Line
                        key={s.id}
                        dataKey={`${smooth ? "s" : "t"}${s.id}`}
                        name={s.name}
                        stroke={style(s.id).stroke}
                        strokeDasharray={style(s.id).dash}
                        {...SERIES}
                        connectNulls
                      />
                    ))}
                    {/* Drag either handle to zoom into a stretch of the trend. */}
                    <Brush
                      dataKey="ts"
                      height={22}
                      travellerWidth={8}
                      tickFormatter={clockFor(hours)}
                      className="fill-muted"
                      stroke="var(--color-muted-foreground)"
                      onChange={(r) => setWindow([r.startIndex ?? 0, r.endIndex ?? pingRows.length - 1])}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Under the chart rather than above it: what the chart covers
                is picked at the top, what is drawn in it is picked here.
                Recharts paints the brush into the same SVG as the axis, so
                this is as close beneath it as HTML can sit. */}
            {(pingSeries.length > 1 || pingSeries.some((s) => s.loss > 0)) && (
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
                    {/* The line is only what answered. A probe dropping half
                        its packets draws exactly like a healthy one, so the
                        figure has to be written somewhere. */}
                    {s.loss > 0 && <span className="tabular-nums opacity-60">丢 {s.loss}%</span>}
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
              <AreaChart data={metricRows}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis {...timeAxis(metricRows)} />
                <YAxis domain={[0, 100]} unit="%" width={Y_WIDTH} {...AXIS} />
                <Tooltip
                  labelFormatter={(ts) => new Date(Number(ts)).toLocaleString("zh-CN")}
                  formatter={(v, name) => [name === "cpu" ? `${Number(v).toFixed(1)}%` : Number(v).toFixed(2), name === "cpu" ? "CPU" : "负载"]}
                  contentStyle={{ fontSize: 12 }}
                />
                <Area dataKey="cpu" stroke="var(--color-chart-1)" fill="var(--color-chart-1)" fillOpacity={0.15} {...SERIES} />
                <Area dataKey="load1" stroke="var(--color-chart-3)" fill="none" {...SERIES} />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title="内存">
            <ResponsiveContainer>
              <AreaChart data={metricRows}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis {...timeAxis(metricRows)} />
                <YAxis tickFormatter={axisBytes} width={Y_WIDTH} {...AXIS} />
                <Tooltip
                  labelFormatter={(ts) => new Date(Number(ts)).toLocaleString("zh-CN")}
                  formatter={(v) => bytes(Number(v))}
                  contentStyle={{ fontSize: 12 }}
                />
                <Area dataKey="mem_used" name="内存" stroke="var(--color-chart-2)" fill="var(--color-chart-2)" fillOpacity={0.15} {...SERIES} />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title="网络速率">
            <ResponsiveContainer>
              <LineChart data={metricRows}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis {...timeAxis(metricRows)} />
                <YAxis tickFormatter={axisBytes} width={Y_WIDTH} {...AXIS} />
                <Tooltip
                  labelFormatter={(ts) => new Date(Number(ts)).toLocaleString("zh-CN")}
                  formatter={(v) => rate(Number(v))}
                  contentStyle={{ fontSize: 12 }}
                />
                <Line dataKey="net_rx" name="下行" stroke="var(--color-ok)" {...SERIES} />
                <Line dataKey="net_tx" name="上行" stroke="var(--color-chart-1)" {...SERIES} />
              </LineChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title="硬盘">
            <ResponsiveContainer>
              <AreaChart data={metricRows}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis {...timeAxis(metricRows)} />
                {/* Anchored at zero like the memory panel above, so a few
                    hundred megabytes of churn cannot be magnified into a
                    cliff, while the range still fills the panel enough to show
                    a disk that is filling up. The size it is filling is one
                    line up, under 内存 / 硬盘. */}
                <YAxis tickFormatter={axisBytes} width={Y_WIDTH} {...AXIS} />
                <Tooltip
                  labelFormatter={(ts) => new Date(Number(ts)).toLocaleString("zh-CN")}
                  formatter={(v) => bytes(Number(v))}
                  contentStyle={{ fontSize: 12 }}
                />
                <Area dataKey="disk_used" name="硬盘" stroke="var(--color-chart-2)" fill="var(--color-chart-2)" fillOpacity={0.15} {...SERIES} />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>
        </div>
      )}
    </div>
  )
}
