import type { WindOverview, WindProjectTracking } from "@aihot/contracts/wind";
import { Form, Link } from "react-router";
import type { Route } from "./+types/projects";
import { adminGet } from "../../lib/admin.server";
import { AdminPage, Badge, ButtonLink, Card, DataTable, Input, Stat } from "../../features/admin/ui";

export async function loader({ request }: Route.LoaderArgs) {
  const query = new URL(request.url).searchParams.get("q") ?? "";
  const [list, overview, inbox] = await Promise.all([adminGet<{ rows: WindProjectTracking[] }>(request, `/api/admin/wind/projects?${new URLSearchParams({ q: query })}`), adminGet<WindOverview>(request, "/api/admin/wind/overview"), adminGet<{ rows: unknown[] }>(request, "/api/admin/wind/progress/inbox")]);
  return { ...list, overview, query, unassignedCount: inbox.rows.length };
}
export default function Projects({ loaderData: { rows, overview, query, unassignedCount } }: Route.ComponentProps) {
  return <AdminPage title="风电项目跟进" subtitle="从项目底表进入每个项目，查看持续进展、最近节点和公告依据。已有公告与邮件中的进展归入对应项目。" actions={<><a href="/api/admin/wind/export" className="text-[13px] text-accent">导出底表</a><ButtonLink to="/admin/projects/import" tone="primary">导入项目底表</ButtonLink></>}>
    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="已接入项目" value={overview.projects} /><Stat label="待复核状态变化" value={overview.pending} tone="warn" /><Stat label="已确认事实变化" value={overview.confirmed} tone="ok" /><Stat label="待归属进展" value={unassignedCount} /></div>
    <Card title="底表项目" right={<span>选择项目查看完整跟进过程</span>}>
      <Form method="get" className="mb-4 flex gap-2"><Input name="q" aria-label="搜索项目" defaultValue={query} placeholder="搜索项目名称、别名或 ID" /><button className="shrink-0 px-3 text-[13px] text-accent">搜索</button></Form>
      <DataTable rows={rows} rowKey={p => p.id} empty={<span>先导入项目底表。尚未对应到底表的公告进展保存在待归属队列。</span>} columns={[
        { key: "name", label: "项目", render: p => <><Link to={`/admin/projects/${encodeURIComponent(p.id)}`} className="font-medium text-accent">{p.name}</Link><div className="mt-1 text-[11px] text-ink-4">{p.id} {p.id.startsWith("DEMO-") ? "· 示例数据" : ""}</div></> },
        { key: "location", label: "区域", render: p => `${p.province} ${p.city}`.trim() || "未填写" },
        { key: "capacity", label: "参考容量", render: p => p.capacityMw ? `${p.capacityMw} MW` : "未记录" },
        { key: "latest", label: "最近跟进节点", render: p => p.latestProgress ? <><div>{p.latestProgress.eventType || "项目进展"} · {p.latestProgress.eventDate ?? "日期待补"}</div><div className="mt-1 max-w-sm text-[12px] text-ink-3">{p.latestProgress.summary.slice(0, 90)}{p.latestProgress.summary.length > 90 ? "…" : ""}</div></> : "尚无进展记录" },
        { key: "progress", label: "跟进记录", render: p => <Link className="text-accent" to={`/admin/projects/${encodeURIComponent(p.id)}#progress`}>{p.progressCount} 条</Link> },
        { key: "priority", label: "关注", render: p => <Badge tone={p.priority === "high" ? "accent" : "muted"}>{p.priority === "high" ? "重点" : "常规"}</Badge> },
        { key: "pending", label: "待复核", render: p => p.pending },
        { key: "enabled", label: "关注状态", render: p => p.enabled ? "持续关注" : "暂停" },
      ]} />
    </Card>
  </AdminPage>;
}
