import { WIND_FIELDS, type WindChange, type WindProgress } from "@aihot/contracts/wind";
import { Link } from "react-router";
import { Badge, Card } from "./ui";
import { scopeLabel } from "./wind";

export function ProjectProgress({ progress, changes }: { progress: WindProgress[]; changes: WindChange[] }) {
  const items = [
    ...progress.map(p => ({ key: `record:${p.key}`, date: p.eventDate, progress: p, change: null })),
    ...changes.map(c => ({ key: `change:${c.id}`, date: c.eventDate, progress: null, change: c })),
  ].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || a.key.localeCompare(b.key));
  return <section id="progress"><Card title={`项目跟进过程 · ${items.length} 条`} right={<span className="text-[12px] text-ink-3">按事件日期排列</span>}>
    <p className="mb-5 text-[13px] text-ink-3">每条记录是这个项目的一次进展。同一事件的重复通知合并展示；原始公告和通知凭据保留在记录内。</p>
    <ol className="space-y-5">{items.map(({ key, date, progress: p, change: c }) => <li key={key} className="border-l-2 border-accent/50 pl-4">
      <div className="mb-1 text-[12px] text-ink-3">{date ?? "事件日期待补"}</div>
      <div className="flex flex-wrap items-center gap-2"><strong className="text-[15px]">{p ? p.eventType || "项目进展" : `${WIND_FIELDS[c!.field]}：${String(c!.after)}`}</strong><Badge tone={p ? "warn" : "ok"}>{p ? "已记录 · 原公告待核对" : "已复核"}</Badge></div>
      <p className="mt-2 whitespace-pre-wrap text-[14px] leading-7 text-ink-2">{p ? p.summary : c!.quote}</p>
      {p?.suggestedStage ? <p className="mt-2 text-[12px] text-ink-3">当时记录的阶段：{p.suggestedStage}</p> : null}
      {p?.risk ? <p className="mt-2 text-[12px] text-ink-3">后续关注：{p.risk}</p> : null}
      {p?.sourceUrl ? <a className="mt-2 inline-block text-[13px] text-accent" href={p.sourceUrl} target="_blank" rel="noreferrer">公告依据 · {p.sourceName || "原文"}</a> : p ? <p className="mt-2 text-[12px] text-ink-3">公告直达链接待补</p> : <p className="mt-2 text-[12px] text-ink-3">{scopeLabel(c!.scope)} · 复核依据：{c!.reason} · <Link className="text-accent" to={`/admin/wind/evidence/${c!.evidenceId}`}>公告证据</Link></p>}
      {p ? <details className="mt-3 text-[12px] text-ink-3"><summary className="cursor-pointer">原始记录与通知凭据 · {p.records.length} 份</summary><ul className="mt-2 space-y-2">{p.records.map(r => <li key={`${r.historyId}:${r.eventIndex}`}><Link to={`/admin/wind/history/${r.historyId}#event-${r.eventIndex}`} className="text-accent">{r.title}</Link><div>{r.notification === "sent_record" ? "有邮件发送记录" : r.notification === "not_sent" ? "当时未发送邮件" : "通知状态未知"}{r.sourceAt ? ` · 记录时间 ${new Date(r.sourceAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}` : ""} · {r.method === "manual" ? "人工确认归属" : "名称匹配归属"}</div></li>)}</ul></details> : null}
    </li>)}</ol>
    {!items.length ? <p className="text-[13px] text-ink-3">尚无项目进展。公告归属到这个项目后，将持续积累在这里。</p> : null}
  </Card></section>;
}
