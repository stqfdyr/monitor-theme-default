// Every figure on the page goes through this file, so it is the one place
// worth a check. Run it with `npm test` — Node strips the types itself, so
// this needs no runner, no framework and no dependency.
//
// Not imported by anything, so the bundle never sees it.
import { axisBytes, axisTop, bytes, cpuName, daysUntil, osName, pair, quarters, timeTicks, uptime } from "./format.ts"

let failed = 0
function eq(got: unknown, want: unknown, what: string) {
  const [a, b] = [JSON.stringify(got), JSON.stringify(want)]
  if (a !== b) {
    failed++
    console.error(`✗ ${what}\n    得到 ${a}\n    期望 ${b}`)
  }
}

// bytes: the significant-digit ladder, and the sub-byte case that used to
// print "512 undefined".
eq(bytes(0), "0 B", "bytes(0)")
eq(bytes(0.5), "0 B", "bytes(0.5) 不能落到 UNITS[-1]")
eq(bytes(-1), "0 B", "bytes(负数)")
eq(bytes(1023), "1023 B", "bytes 在 B 档不带小数")
eq(bytes(1024), "1.00 KB", "bytes(1 KiB)")
eq(bytes(10 * 1024), "10.0 KB", "两位数留一位小数")
eq(bytes(100 * 1024), "100 KB", "三位数不留小数")
eq(bytes(1024, 1), "1.0 KB", "digits 覆盖默认档位")

// pair: one unit when both sides share it, two when they do not.
eq(pair(300 * 1024 ** 2, 900 * 1024 ** 2), "300.00 / 900.00 MB", "同单位只写一次")
eq(pair(300 * 1024 ** 2, 3 * 1024 ** 3), "300 MB / 3.00 GB", "跨单位各写各的")

// axisBytes: ticks under three digits keep one decimal, or a narrow axis
// prints the same label twice; a trailing .0 is noise.
eq(axisBytes(3.2 * 1024 ** 3), "3.2 GB", "窄轴刻度保留一位")
eq(axisBytes(2 * 1024 ** 3), "2 GB", "整数刻度不写 .0")
eq(axisBytes(0), "0 B", "零刻度")

// axisTop: the top is derived from a round gridline, so quarters() lands on
// round values in the unit the axis is finally printed in.
eq(axisTop(0.4, 4, 10, 100), 4, "闲置机器拿到地板值")
eq(axisTop(63, 4, 10, 100), 80, "63% -> 0/20/40/60/80")
eq(axisTop(200, 4, 10, 100), 100, "百分比封顶")
eq(axisTop(25_000_000, 1024, 1024), 32 * 1024 ** 2, "字节轴按 1024 取整")
eq(quarters(32 * 1024 ** 2).map(axisBytes), ["0 B", "8 MB", "16 MB", "24 MB", "32 MB"], "四条网格线都是整值")
// 四条刻度是 step·[1,2,3,4]，约束落在第三条上：3m 也得能被 axisBytes 精确打出来，
// 而它只给一位小数。2 的幂都满足；半档 384 和 768 不满足，第三条刻度分别是 1.125 Ki
// 和 2.25 Ki，打成 "1.1" 和 "2.3"。这两档正好盖住 1–1.5 MB/s 与 2–3 MB/s。
// 断言打在标签上——只看 top 的比例会从这条坏刻度旁边走过去。
eq(quarters(axisTop(2_621_440, 1024, 1024)).map(axisBytes),
   ["0 B", "1 MB", "2 MB", "3 MB", "4 MB"], "峰值 2.5 MB/s 的四条刻度")
eq(quarters(axisTop(1_258_291, 1024, 1024)).map(axisBytes),
   ["0 B", "512 KB", "1 MB", "1.5 MB", "2 MB"], "峰值 1.2 MB/s 的四条刻度")
// 轴顶必须来自梯子，不能是数据本身。十进制梯子配 1024 进制的 scale 最大只到
// 10·1024^k，越过那一档 find 就落空，`?? target` 兜底把轴顶设成 max —— 网格线随之
// 变成 max/4 这种非整值，正是这个函数要消灭的东西。只在 [4,40)·1024^k 几段窄带里
// 成立，而 40 KB/s–4 MB/s 恰好是 VPS 最常见的区间。
for (const max of [3_000, 300_000, 3_000_000, 300_000_000]) {
  const top = axisTop(max, 1024, 1024)
  eq(top > max, true, `${max} B/s 的轴顶不能等于数据本身`)
  // 2 而不是 1.5：梯子去掉半档之后，最坏情况是下一档 2 的幂。
  eq(top / max < 2, true, `${max} B/s 的轴顶不能浪费整块面板`)
}

// timeTicks: round clock values, phased on local midnight rather than the
// epoch, and never more than asked for.
{
  const day = 86_400_000
  const to = Date.now()
  const ticks = timeTicks(to - day, to)
  eq(ticks.length <= 8, true, `24 小时窗最多 8 个刻度（得到 ${ticks.length}）`)
  eq(
    ticks.every((t) => new Date(t).getMinutes() === 0 && new Date(t).getSeconds() === 0),
    true,
    "刻度落在整点上",
  )
  eq(
    ticks.every((t, i) => i === 0 || t - ticks[i - 1] === ticks[1] - ticks[0]),
    true,
    "刻度间距均匀",
  )
  eq(timeTicks(to, to - day), [], "反向区间不产出刻度")
}

// daysUntil: whole days, negative once past, null when there is no date.
{
  const at = (days: number) => {
    const d = new Date()
    d.setDate(d.getDate() + days)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  }
  eq(daysUntil(at(10)), 10, "十天后")
  eq(daysUntil(at(-3)), -3, "已过期为负")
  eq(daysUntil(null), null, "无到期日")
  eq(daysUntil("不是日期"), null, "无法解析的日期")
}

eq(uptime(0), "—", "没上报过就不写时长")
eq(uptime(90), "1 分", "不足一小时")
eq(uptime(3 * 3600 + 25 * 60), "3 小时 25 分", "不足一天")
eq(uptime(2 * 86400 + 5 * 3600), "2 天 5 小时", "超过一天不再写分钟")

eq(osName("Debian GNU/Linux 12 (bookworm)"), "Debian 12", "发行版名去掉代号")
eq(cpuName("Intel(R) Xeon(R) CPU E5-2680 8-Core Processor"), "Intel Xeon E5-2680", "CPU 名去掉商标和核数")

if (failed) {
  console.error(`\n${failed} 项不通过`)
  throw new Error("format 校验未通过")
}
console.log("format 校验通过")
