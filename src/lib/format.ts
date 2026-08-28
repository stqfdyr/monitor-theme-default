/** 1024-based, because every VPS dashboard and `df` report bytes this way. */
export function bytes(n: number, digits = 2): string {
  if (!n || n < 0) return "0 B"
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"]
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1)
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : digits)} ${units[i]}`
}

/// Axis ticks. Whole units alone are too coarse for an axis spanning a narrow
/// band — a disk at 3.2 GiB drew ticks reading 3 GiB, 2 GiB, 2 GiB, 811 MiB,
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

export function clock(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
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
