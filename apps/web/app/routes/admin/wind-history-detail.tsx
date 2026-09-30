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
export default function HistoryDetail({ loaderData: { record: r, projects } }: Route.ComponentProps) {
  const { run, busy } = useAdminAction(); const [selection, setSelection] = useState<string[] | null>(null);
  const ids = selection ?? r.projects.map(p => p.id);
  return <AdminPage title={r.title} subtitle="历史通知及报告档案。摘要中的置信度或已发送状态不等于原公告事实已核实。" actions={<ButtonLink to="/admin/wind/history">返回历史资料</ButtonLink>}>
    <Card title="历史来源"><KV items={[["来源类型", ({ gmail: "Gmail 邮件", conversation: "监控会话", file: "历史文件" })[r.origin]], ["原记录 ID", r.externalId], ["原记录时间", r.sourceAt ? new Date(r.sourceAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "未提供，未推测"], ["导入时间", new Date(r.importedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })], ["通知状态", ({ sent_record: "Gmail 有已发送记录；投递及已读状态未知", not_sent: "历史报告记载邮件未发送", unknown: "未取得可验证发送记录" })[r.notification]], ["历史原件", r.archiveUrl ? <a href={r.archiveUrl} target="_blank" rel="noreferrer" className="text-accent">查看原记录</a> : "未提供"], ["解析说明", r.parseNote]]} /></Card>
    <div className="mt-5 space-y-5">{r.events.map((e, i) => <Card key={i} title={`${e.projectHint} · ${e.eventType || "未分类"}`} right={<Badge tone="warn">历史摘要待核对</Badge>}><p className="whitespace-pre-wrap text-[14px] leading-7 text-ink-2">{e.summary}</p><div className="mt-3 text-[13px] text-ink-3">事件日期：{e.eventDate ?? "未明确"} · 原报告来源：{e.sourceName || "未注明"}</div>{e.sourceUrl ? <a href={e.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[13px] text-accent">核对原公告链接</a> : <p className="mt-2 text-[13px] text-ink-3">原报告未保留直达链接，需要补找原公告。</p>}{e.risk ? <p className="mt-3 text-[13px] text-ink-3">原记录风险说明：{e.risk}</p> : null}<p className="mt-2 text-[13px] text-ink-3">原建议阶段：{e.suggestedStage || "未注明"}</p></Card>)}
      <Card title="关联到项目"><p className="mb-3 text-[13px] text-ink-3">可关联多个项目。名称自动匹配仅供核对；保存关联不会确认事实。</p>{projects.map(p => <label key={p.id} className="mb-2 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={ids.includes(p.id)} onChange={e => setSelection(e.target.checked ? [...ids, p.id] : ids.filter(id => id !== p.id))} />{p.name}</label>)}{!projects.some(p => !p.id.startsWith("DEMO-")) ? <p className="mb-3 text-[13px] text-ink-3">目前只有示例底表，请先导入真实项目。</p> : null}<Button disabled={busy} onClick={async () => { const result = await run("POST", `/api/admin/wind/history/${r.id}/projects`, { projectIds: ids }, { success: "项目关联已保存" }); if (result) setSelection(null); }}>保存项目关联</Button>{r.projects.map(p => <Link key={p.id} to={`/admin/projects/${encodeURIComponent(p.id)}`} className="mt-2 block text-[13px] text-accent">{p.name} · {p.method === "manual" ? "人工关联" : "名称匹配待核对"}</Link>)}</Card>
      <Card title="完整原记录"><pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-7 text-ink-2">{r.body}</pre></Card>
    </div>
  </AdminPage>;
}
