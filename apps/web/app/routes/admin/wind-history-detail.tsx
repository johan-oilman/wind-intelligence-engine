import type { WindHistoryRecord, WindProject } from "@aihot/contracts/wind";
import { useState } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/wind-history-detail";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { AdminPage, Badge, Button, ButtonLink, Card, KV } from "../../features/admin/ui";

export async function loader({ request, params }: Route.LoaderArgs) {
  const [record, list] = await Promise.all([adminGet<WindHistoryRecord>(request, `/api/admin/wind/history/${params.historyId}`), adminGet<{ rows: WindProject[] }>(request, "/api/admin/wind/projects")]);
  return { record, projects: list.rows };
}
function EventOwnership({ record, index, projects }: { record: WindHistoryRecord; index: number; projects: WindProject[] }) {
  const { run, busy } = useAdminAction();
  const [selection, setSelection] = useState<string[] | null>(null);
  const targets = (record.eventProjects ?? []).filter(p => p.eventIndex === index);
  const ids = selection ?? targets.map(p => p.projectId);
  return <div className="mt-4 border-t border-line pt-4">
    <p className="mb-3 text-[13px] font-medium">这条进展属于哪个底表项目？</p>
    <p className="mb-3 text-[12px] text-ink-3">逐条确认，多项目报告中的其他事件不会跟着归入。联合工程可选择多个项目。</p>
    <div className="grid gap-2 sm:grid-cols-2">{projects.map(p => <label key={p.id} className="flex items-center gap-2 text-[13px]"><input type="checkbox" aria-label={`事件 ${index + 1} 归属 ${p.name}`} checked={ids.includes(p.id)} onChange={e => setSelection(e.target.checked ? [...ids, p.id] : ids.filter(id => id !== p.id))} />{p.name}</label>)}</div>
    <Button className="mt-3" disabled={busy} onClick={async () => { const result = await run("POST", `/api/admin/wind/history/${record.id}/events/${index}/projects`, { projectIds: ids }, { success: ids.length ? "进展已归入对应项目" : "已标记暂不归入项目进展，原文仍保留" }); if (result) setSelection(null); }}>保存这条进展的归属</Button>
    {targets.map(p => <Link key={p.projectId} to={`/admin/projects/${encodeURIComponent(p.projectId)}#progress`} className="mt-2 block text-[13px] text-accent">查看 {p.projectName} 的跟进过程</Link>)}
    {!projects.length ? <p className="mt-3 text-[13px] text-ink-3">先导入项目底表，再选择对应项目。</p> : null}
  </div>;
}
export default function ProgressRecord({ loaderData: { record: r, projects } }: Route.ComponentProps) {
  return <AdminPage title="项目进展记录" subtitle={r.title} actions={<ButtonLink to="/admin/projects">返回项目底表</ButtonLink>}>
    <div className="space-y-5">{r.events.map((e, i) => <section key={i} id={`event-${i}`}><Card title={`${e.projectHint} · ${e.eventType || "项目进展"}`} right={<Badge tone="warn">原公告待核对</Badge>}>
      <p className="whitespace-pre-wrap text-[14px] leading-7 text-ink-2">{e.summary}</p>
      <p className="mt-3 text-[13px] text-ink-3">事件日期：{e.eventDate ?? "待补"} · 公告来源：{e.sourceName || "未注明"}</p>
      {e.sourceUrl ? <a href={e.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[13px] text-accent">查看公告依据</a> : null}
      {e.risk ? <p className="mt-3 text-[13px] text-ink-3">后续关注：{e.risk}</p> : null}
      {!["历史监控范围恢复", "重点项目线索"].includes(e.eventType) ? <EventOwnership record={r} index={i} projects={projects} /> : <p className="mt-3 text-[13px] text-ink-3">这是监控规则或项目发现线索，保留作为参考资料，不计入项目工程进展。</p>}
    </Card></section>)}
      {!r.events.length ? <Card title="原记录待整理"><p className="text-[13px] text-ink-3">这份原记录尚未提取出具体项目事件，不能整封归入某个项目的工程进展。</p></Card> : null}
      <details className="rounded-card border border-line bg-surface p-4"><summary className="cursor-pointer text-[14px] font-medium">来源与通知凭据</summary><div className="mt-4"><KV items={[
        ["原件", r.archiveUrl ? <a href={r.archiveUrl} target="_blank" rel="noreferrer" className="text-accent">打开原记录</a> : "未提供"],
        ["记录时间", r.sourceAt ? new Date(r.sourceAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "未知"],
        ["通知状态", ({ sent_record: "有邮件发送记录；投递与已读状态未知", not_sent: "当时未发送邮件", unknown: "通知状态未知" })[r.notification]],
        ["来源说明", r.parseNote],
      ]} /></div><pre className="mt-4 whitespace-pre-wrap break-words font-sans text-[13px] leading-7 text-ink-2">{r.body}</pre></details>
    </div>
  </AdminPage>;
}
