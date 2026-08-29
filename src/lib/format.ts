const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"]

const unitOf = (n: number) => Math.min(Math.floor(Math.log(n) / Math.log(1024)), UNITS.length - 1)

/// 1024-based, because every VPS dashboard and `df` report bytes this way, but
/// labelled MB/GB the way `df -h` and every hosting plan write it — nobody sells
/// a "1000 GiB" plan, and the two extra letters were what pushed the memory and
/// traffic lines past their column.
///
/// Three significant digits by default — "265 GB" of lifetime traffic, "1.8 KB/s"
/// of live rate. Two decimals everywhere was what forced the card's lines to end
/// in an ellipsis on a four-column grid; a pair that shares a unit buys them back
/// through pair() below, by writing the unit once.
export function bytes(n: number, digits?: number): string {
  if (!n || n < 0) return "0 B"
  const i = unitOf(n)
  const v = n / 1024 ** i
  return `${v.toFixed(i === 0 ? 0 : (digits ?? (v >= 100 ? 0 : v >= 10 ? 1 : 2)))} ${UNITS[i]}`
}

/// A "used / total" pair. When both land in the same unit the unit is written
/// once, and the four characters that saves are exactly what buys back the two
/// decimals: measured, 111px against the 122px a card in the four-column grid
/// gives it, where spelling out both units needs 132px. A pair spanning two
/// units has nothing to save, so it falls back to bytes() and its three
/// significant digits (96px), which fits either way.
export function pair(used: number, total: number): string {
  if (used > 0 && total > 0 && unitOf(used) === unitOf(total)) {
    const i = unitOf(total)
    const f = (n: number) => (n / 1024 ** i).toFixed(i === 0 ? 0 : 2)
    return `${f(used)} / ${f(total)} ${UNITS[i]}`
  }
  return `${bytes(used)} / ${bytes(total)}`
}

/// Axis ticks. Whole units alone are too coarse for an axis spanning a narrow
/// band — a disk at 3.2 GB drew ticks reading 3 GB, 2 GB, 2 GB, 811 MB,
/// 0 B, the same label twice — so ticks under three digits keep one decimal.
/// Past that the next tick is a whole unit away anyway, and the label has to
/// stay inside the axis rather than wrapping onto a second line.
export function axisBytes(v: number): string {
  if (!v || v < 0) return "0 B"
  const unit = Math.min(Math.floor(Math.log(v) / Math.log(1024)), 5)
  return bytes(v, v / 1024 ** unit >= 100 ? 0 : 1).replace(".0 ", " ")
}

export function rate(n: number): string {
  return `${bytes(n, 1)}/s`
}

export function percent(used: number, total: number): number {
  return total > 0 ? Math.min(100, (used / total) * 100) : 0
}

export function uptime(seconds: number): string {
  if (!seconds) return "—"
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return d > 0 ? `${d} 天 ${h} 小时` : h > 0 ? `${h} 小时 ${m} 分` : `${m} 分`
}

/** Whole days until a date, negative once it has passed. */
export function daysUntil(date?: string | null): number | null {
  if (!date) return null
  const target = new Date(`${date}T00:00:00`).getTime()
  if (Number.isNaN(target)) return null
  return Math.ceil((target - Date.now()) / 86400000)
}

/// No expiry, no traffic cap: the same "there is no ceiling here" either way.
/// U+221E rather than the ♾️ emoji — the emoji arrives as a coloured tile from
/// whatever font the visitor has, which on a greyscale page is the loudest
/// thing on the card; this one inherits the text colour and size.
export const FOREVER = "∞"

const SYMBOLS: Record<string, string> = { USD: "$", CNY: "¥", EUR: "€", GBP: "£", JPY: "¥" }

export function money(amount: number, currency: string): string {
  return `${SYMBOLS[currency] ?? ""}${amount.toFixed(2)}${SYMBOLS[currency] ? "" : ` ${currency}`}`
}

export const CYCLES: Record<string, string> = {
  monthly: "月付",
  quarterly: "季付",
  semiannual: "半年付",
  yearly: "年付",
  biennial: "两年付",
  triennial: "三年付",
  once: "一次性",
}

/// Hoisted out of `clock`, because recharts asks a tickFormatter for every
/// sample when it lays an axis out, not once per tick it draws. Building an
/// Intl formatter per call was the single largest cost on the detail page:
/// 348 ms of a 1531 ms click-to-chart, against the live database's 1436 ping
/// samples. Reused, the same page draws in 960 ms. The zone resolves once now
/// rather than per call, which only an OS timezone change under an open tab
/// would notice.
///
/// Both of these take **epoch milliseconds**, which is also what the charts
/// feed their time axis: recharts hands `scale="time"` straight to a d3 time
/// scale, and a scale given seconds reads 1.79e9 as three weeks past the epoch
/// and lays its ticks out accordingly -- 05:14, 10:22, 15:30 instead of 06:00,
/// 12:00, 18:00. The hub answers in seconds; the chart multiplies once.
const HHMM = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" })

const MDHHMM = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
})

export function clock(ms: number): string {
  return HHMM.format(ms)
}

/// Axis ticks for a window `hours` wide. Past a day a bare "14:00" comes round
/// again every midnight and the axis stops saying which day it means — the
/// seven-day chart read 03:21 … 23:53 … 02:27 with nothing to separate Tuesday
/// from Wednesday.
export function clockFor(hours: number): (ms: number) => string {
  return hours <= 24 ? clock : (ms: number) => MDHHMM.format(ms)
}

/// Distro and CPU names as their vendors write them are mostly ceremony: a
/// codename in brackets, "GNU/Linux", "(R)", a core count the card prints
/// separately anyway. Stripping it is what makes the line fit instead of
/// ending in an ellipsis.
export function osName(name: string): string {
  return name.replace("GNU/Linux ", "").replace(/\s*\([^)]*\)\s*$/, "")
}

export function cpuName(name: string): string {
  return name
    .replace(/\((R|TM|r|tm)\)/g, "")
    .replace(/\s+(CPU|Processor)\b/g, "")
    .replace(/\s+\d+-Core\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/// Ticks on round clock values across `[from, to]`, in epoch milliseconds.
///
/// recharts picks axis ticks by "nice number" on the raw value, which on a
/// timestamp means 05:14 and 10:22 where a chart wants 06:00 and 12:00 — it
/// never reaches for a time scale's own ticks, whatever `scale` says. So the
/// axis is handed the list instead: the smallest step from the ladder that
/// keeps the count under `count`, phased on local midnight rather than on the
/// epoch, so a daily tick lands on the day and a half-hourly one on the half
/// hour even in a zone offset by 30 or 45 minutes.
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440, 2880, 10080].map((m) => m * 60_000)

export function timeTicks(from: number, to: number, count = 8): number[] {
  const step = TICK_STEPS.find((s) => (to - from) / s <= count) ?? TICK_STEPS[TICK_STEPS.length - 1]
  const zone = new Date(from).getTimezoneOffset() * 60_000
  const ticks: number[] = []
  for (let t = Math.ceil((from - zone) / step) * step + zone; t <= to; t += step) ticks.push(t)
  return ticks
}
