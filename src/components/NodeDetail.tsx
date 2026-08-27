import { useEffect, useState } from "react"
import { ArrowLeft } from "lucide-react"
import { median } from "d3-array"
import {
  Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Status, TRAFFIC_MODES, trafficFoot } from "@/components/NodeCard"
import { api, type Node, type PingTask } from "@/lib/api"
import { bytes, clock, CYCLES, money, rate, uptime } from "@/lib/format"

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

const RANGES = [
  { hours: 1, label: "1 小时" },
  { hours: 6, label: "6 小时" },
  { hours: 24, label: "24 小时" },
  { hours: 168, label: "7 天" },
]

const AXIS = { stroke: "currentColor", fontSize: 11, tickLine: false, axisLine: false }

const TABS = [
  { key: "resources", label: "资源" },
  { key: "latency", label: "网络延迟" },
] as const

function Panel({ title, tall, children }: { title: string; tall?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-medium text-muted-foreground">{title}</h4>
      <div className={`${tall ? "h-72" : "h-40"} w-full text-muted-foreground`}>{children}</div>
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

function Fact({ label, value }: { label: string; value?: string | number | null }) {
  if (value === null || value === undefined || value === "") return null
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm">{value}</dd>
    </div>
  )
}

export function NodeDetail({ node, tasks, onBack }: { node: Node; tasks: PingTask[]; onBack: () => void }) {
  const [hours, setHours] = useState(6)
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("resources")
  const [smooth, setSmooth] = useState(false)
  const [data, setData] = useState<{ metrics: Point[]; ping: PingPoint[] } | null>(null)

  useEffect(() => {
    setData(null)
    api<{ metrics: Point[]; ping: PingPoint[] }>(`/nodes/${node.id}/metrics?hours=${hours}`)
      .then(setData)
      .catch(() => setData({ metrics: [], ping: [] }))
  }, [node.id, hours])

  const m = node.metrics
  // One series per probe that actually reported. Grouping by what came back
  // rather than by the task list means visitors see the chart too — only an
  // admin can read task names, and an id is a good enough label without one.
  const pingSeries = [...new Set((data?.ping ?? []).map((p) => p.task_id))]
    .map((id) => ({
      id,
      name: tasks.find((t) => t.id === id)?.name ?? `探测 ${id}`,
      points: (data?.ping ?? []).filter((p) => p.task_id === id && p.latency >= 0),
    }))
    .filter((s) => s.points.length > 0)

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft /> 返回
        </Button>
        <h2 className="truncate text-lg font-medium">{node.name}</h2>
        <Status node={node} />
        {node.agent_version && (
          <Badge variant="outline" className="font-normal">
            agent {node.agent_version}
          </Badge>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Fact label="主机名" value={node.hostname} />
        <Fact label="系统" value={node.os} />
        <Fact label="内核" value={node.kernel} />
        <Fact label="架构" value={`${node.arch}${node.virt && node.virt !== "none" ? ` · ${node.virt}` : ""}`} />
        <Fact label="CPU" value={node.cpu_name ? `${node.cpu_name} × ${node.cpu_cores}` : null} />
        <Fact label="内存 / 硬盘" value={`${bytes(node.mem_total)} / ${bytes(node.disk_total)}`} />
        <Fact label="IP" value={node.ip} />
        <Fact label="运行时间" value={m ? uptime(m.uptime) : null} />
        <Fact
          label="价格"
          value={node.price > 0 ? `${money(node.price, node.currency)} / ${CYCLES[node.billing_cycle] ?? node.billing_cycle}` : null}
        />
        <Fact label="到期" value={node.expires_at} />
        <Fact label="连接数" value={m ? `TCP ${m.tcp} · UDP ${m.udp}` : null} />
        <Fact label="进程" value={m?.procs} />
        <Fact label="本月流量" value={trafficFoot(node)} />
        <Fact label="今日流量" value={`↓ ${bytes(node.day_rx)} · ↑ ${bytes(node.day_tx)}`} />
        <Fact label="累计流量" value={`↓ ${bytes(node.total_rx)} · ↑ ${bytes(node.total_tx)}`} />
        <Fact
          label="流量周期"
          value={`每月 ${node.traffic_reset_day} 日重置 · ${TRAFFIC_MODES[node.traffic_mode] ?? node.traffic_mode}`}
        />
      </dl>

      {node.remark && (
        <p className="rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-wrap">{node.remark}</p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-4">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <Tab key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>
              {t.label}
            </Tab>
          ))}
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <Tab key={r.hours} active={hours === r.hours} onClick={() => setHours(r.hours)}>
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

      {!data ? (
        <Skeleton className="h-40 w-full" />
      ) : tab === "latency" ? (
        pingSeries.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">这段时间没有延迟数据</p>
        ) : (
          <Panel title={`延迟监控 (TCP)${smooth ? " · 已削峰" : ""}`} tall>
            <ResponsiveContainer>
              <LineChart>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis
                  dataKey="ts"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={clock}
                  {...AXIS}
                  minTickGap={40}
                />
                <YAxis unit="ms" width={48} {...AXIS} />
                <Tooltip
                  labelFormatter={(ts) => new Date(Number(ts) * 1000).toLocaleString("zh-CN")}
                  formatter={(v) => `${Number(v)} ms`}
                  contentStyle={{ fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {pingSeries.map((s, i) => (
                  <Line
                    key={s.id}
                    data={smooth ? despike(s.points) : s.points}
                    dataKey="latency"
                    name={s.name}
                    stroke={`var(--color-chart-${(i % 5) + 1})`}
                    strokeWidth={1.5}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </Panel>
        )
      ) : data.metrics.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">这段时间还没有历史数据</p>
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
