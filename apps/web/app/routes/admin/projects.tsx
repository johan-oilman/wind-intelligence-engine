import type { WindOverview, WindProject } from "@aihot/contracts/wind";
import { Form, Link } from "react-router";
import type { Route } from "./+types/projects";
import { adminGet } from "../../lib/admin.server";
import { AdminPage, Badge, ButtonLink, Card, DataTable, Input, Stat } from "../../features/admin/ui";

export async function loader({ request }: Route.LoaderArgs) {
  const query = new URL(request.url).searchParams.get("q") ?? "";
  const [list, overview] = await Promise.all([adminGet<{ rows: WindProject[] }>(request, `/api/admin/wind/projects?${new URLSearchParams({ q: query })}`), adminGet<WindOverview>(request, "/api/admin/wind/overview")]);
  return { ...list, overview, query };
}
export default function Projects({ loaderData: { rows, overview, query } }: Route.ComponentProps) {
  return <AdminPage title="项目底表" subtitle="以项目为中心，保存事实、追踪变化和核查证据。导入值为参考底表，已确认事实在项目详情中单独维护。" actions={<><a href="/api/admin/wind/export" className="text-[13px] text-accent">导出 CSV</a><ButtonLink to="/admin/projects/import" tone="primary">导入项目</ButtonLink></>}>
    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="在库项目" value={overview.projects} /><Stat label="待复核线索" value={overview.pending} tone="warn" /><Stat label="已确认事实变化" value={overview.confirmed} tone="ok" /><Stat label="归属待确认" value={overview.unresolved} /></div>
    <Card title="监控项目" right={<span>仅管理员可访问</span>}>
      <Form method="get" className="mb-4 flex gap-2"><Input name="q" aria-label="搜索项目" defaultValue={query} placeholder="搜索项目名称、别名或 ID" /><button className="shrink-0 px-3 text-[13px] text-accent">搜索</button></Form>
      <DataTable rows={rows} rowKey={p => p.id} empty={<span>还没有项目。先导入项目底表，或使用明确标记的示例数据体验流程。</span>} columns={[
        { key: "name", label: "项目", render: p => <><Link to={`/admin/projects/${encodeURIComponent(p.id)}`} className="font-medium text-accent">{p.name}</Link><div className="mt-1 text-[11px] text-ink-4">{p.id} {p.id.startsWith("DEMO-") ? "· 示例数据" : ""}</div></> },
        { key: "location", label: "区域", render: p => `${p.province} ${p.city}`.trim() || "未填写" },
        { key: "capacity", label: "参考容量", render: p => p.capacityMw ? `${p.capacityMw} MW` : "未记录" },
        { key: "priority", label: "关注", render: p => <Badge tone={p.priority === "high" ? "accent" : "muted"}>{p.priority === "high" ? "重点" : "常规"}</Badge> },
        { key: "pending", label: "待复核", render: p => p.pending },
        { key: "enabled", label: "监控", render: p => p.enabled ? "启用" : "暂停" },
      ]} />
    </Card>
  </AdminPage>;
}
