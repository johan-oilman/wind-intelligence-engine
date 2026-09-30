import type { WindHistoryRecord } from "@aihot/contracts/wind";
import { Form, Link } from "react-router";
import type { Route } from "./+types/wind-history";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { AdminPage, Badge, Button, ButtonLink, Card, DataTable, Input, Stat } from "../../features/admin/ui";

export async function loader({ request }: Route.LoaderArgs) {
  const params = new URL(request.url).searchParams;
  return { ...(await adminGet<{ rows: WindHistoryRecord[]; stats: { records: number; emails: number; sent: number; unlinked: number } }>(request, `/api/admin/wind/history?${params}`)), q: params.get("q") ?? "", projectId: params.get("projectId") ?? "" };
}
export default function History({ loaderData: { rows, stats, q, projectId } }: Route.ComponentProps) {
  const { run, busy } = useAdminAction();
  return <AdminPage title="历史监控与邮件" subtitle="保存原有监控报告及邮件记录。这里的摘要尚需核对原公告；导入不会自动更新事实，也不会重新发送通知。" actions={<><ButtonLink to="/admin/projects/import">导入底表</ButtonLink><Button disabled={busy} onClick={() => run("POST", "/api/admin/wind/history/relink", {}, { success: "已按当前底表重新匹配，关联结果仍需核对" })}>按底表匹配项目</Button></>}>
    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="历史记录" value={stats.records} /><Stat label="邮件记录" value={stats.emails} /><Stat label="有已发送记录" value={stats.sent} hint="不代表收件人已读或成功投递" /><Stat label="未关联项目" value={stats.unlinked} tone="warn" /></div>
    <Card title="历史资料" right={<span>仅管理员可访问</span>}><Form method="get" className="mb-4 flex gap-2"><Input name="q" aria-label="搜索历史" defaultValue={q} placeholder="项目名称、事件或标题" />{projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}<button className="shrink-0 px-3 text-[13px] text-accent">搜索</button></Form>
      {projectId ? <p className="mb-3 text-[13px] text-ink-3">按项目筛选 · <Link to="/admin/wind/history" className="text-accent">查看全部</Link></p> : null}
      <DataTable rows={rows} rowKey={r => r.id} empty="还没有导入历史记录。" columns={[
        { key: "title", label: "记录", render: r => <><Link to={`/admin/wind/history/${r.id}`} className="font-medium text-accent">{r.title}</Link><div className="mt-1 text-[11px] text-ink-4">{r.sourceAt ? new Date(r.sourceAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : "原记录时间未知"}</div></> },
        { key: "origin", label: "来源", render: r => ({ gmail: "历史邮件", conversation: "历史监控会话", file: "历史文件" })[r.origin] },
        { key: "events", label: "事件摘要", render: r => r.events.map(e => e.eventType || "未分类").join("、") || "待整理" },
        { key: "notification", label: "通知", render: r => <Badge tone={r.notification === "sent_record" ? "info" : "muted"}>{({ sent_record: "有已发送记录", not_sent: "报告记载未发送", unknown: "发送状态未知" })[r.notification]}</Badge> },
        { key: "project", label: "关联项目", render: r => r.projects.length ? r.projects.map(p => <Link key={p.id} to={`/admin/projects/${encodeURIComponent(p.id)}`} className="block text-accent">{p.name} · {p.method === "manual" ? "人工关联" : "名称匹配待核对"}</Link>) : "未关联，等待原始底表或人工确认" },
      ]} />
    </Card>
  </AdminPage>;
}
