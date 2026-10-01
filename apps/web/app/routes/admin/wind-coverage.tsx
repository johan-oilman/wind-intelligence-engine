import type { WindCoverage } from "@aihot/contracts/wind";
import { Link } from "react-router";
import type { Route } from "./+types/wind-coverage";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { COVERAGE_LABEL } from "../../features/admin/wind";
import { AdminPage, Badge, Button, Card, DataTable, Stat } from "../../features/admin/ui";

export async function loader({ request }: Route.LoaderArgs) {
  const [coverage, runs] = await Promise.all([adminGet<{ rows: WindCoverage[] }>(request, "/api/admin/wind/coverage"), adminGet<{ rows: Array<{ article_id: string; status: string; candidates: number; title: string; checked_at: string }> }>(request, "/api/admin/wind/runs")]);
  return { coverage: coverage.rows, runs: runs.rows };
}
export default function Coverage({ loaderData: { coverage, runs } }: Route.ComponentProps) {
  const { run, busy } = useAdminAction();
  return <AdminPage title="监控覆盖" subtitle="区分检查成功、失败、逾期与未配置。来源检查成功只说明该来源最近可读取，不能证明全网没有项目变化。" actions={<Button disabled={busy} onClick={() => run("POST", "/api/admin/wind/scan", {}, { success: "已处理一批在库材料" })}>处理在库材料</Button>}>
    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="项目与信源关联" value={coverage.length} /><Stat label="最近检查成功" value={coverage.filter(c => c.status === "ok").length} tone="ok" /><Stat label="失败或逾期" value={coverage.filter(c => ["failed", "overdue"].includes(c.status)).length} tone="warn" /><Stat label="尚未检查" value={coverage.filter(c => c.status === "unchecked").length} /></div>
    <Card title="信源覆盖"><DataTable rows={coverage} rowKey={r => `${r.projectId}:${r.sourceId}`} empty="尚未绑定信源。打开项目详情配置已有信源。" columns={[
      { key: "project", label: "项目", render: r => <Link to={`/admin/projects/${encodeURIComponent(r.projectId)}`} className="text-accent">{r.projectName}</Link> },
      { key: "source", label: "信源", render: r => <Link to={`/admin/sources/${encodeURIComponent(r.sourceId)}`} className="text-accent">{r.sourceName}</Link> },
      { key: "status", label: "检查状态", render: r => <Badge tone={r.status === "ok" ? "ok" : ["failed", "overdue"].includes(r.status) ? "warn" : "muted"}>{COVERAGE_LABEL[r.status]}</Badge> },
      { key: "last", label: "最近成功", render: r => r.lastOkAt ? new Date(r.lastOkAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "尚未成功" },
      { key: "error", label: "原因", render: r => r.lastError ?? "—" },
    ]} /></Card>
    <div className="mt-5"><Card title="材料识别记录"><DataTable rows={runs} rowKey={r => r.article_id} empty="没有已处理材料。这里只检查与已绑定信源相关的在库材料。" columns={[
      { key: "title", label: "材料", render: r => r.title },
      { key: "status", label: "识别结果", render: r => ({ ok: "已识别项目", no_match: "未匹配项目", missing_body: "缺少已确认正文" })[r.status] ?? r.status },
      { key: "count", label: "本次新增候选", render: r => r.candidates },
    ]} /></Card></div>
  </AdminPage>;
}
