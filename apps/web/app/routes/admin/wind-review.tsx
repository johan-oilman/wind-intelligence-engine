import type { WindCandidate, WindProject } from "@aihot/contracts/wind";
import type { Route } from "./+types/wind-review";
import { adminGet } from "../../lib/admin.server";
import { CandidateCard } from "../../features/admin/wind";
import { AdminPage, ButtonLink, Empty, FilterChips } from "../../features/admin/ui";

export async function loader({ request }: Route.LoaderArgs) {
  const query = new URL(request.url).searchParams;
  const [items, projects] = await Promise.all([adminGet<{ rows: WindCandidate[] }>(request, `/api/admin/wind/candidates?${new URLSearchParams({ status: query.get("status") ?? "pending", ...(query.get("projectId") ? { projectId: query.get("projectId")! } : {}) })}`), adminGet<{ rows: WindProject[] }>(request, "/api/admin/wind/projects")]);
  return { items: items.rows, projects: projects.rows };
}
export default function Review({ loaderData: { items, projects } }: Route.ComponentProps) {
  return <AdminPage title="变化复核" subtitle="核对项目归属、原文证据、事件日期与标段范围，确认后再更新事实。计划表述与历史补充分别保存。" actions={<ButtonLink to="/admin/wind/evidence">提交公告</ButtonLink>}>
    <FilterChips param="status" options={[{ value: "", label: "待复核" }, { value: "accepted", label: "已确认" }, { value: "rejected", label: "已排除" }, { value: "all", label: "全部" }]} />
    <div className="mt-5 space-y-4">{items.map(i => <CandidateCard key={i.id} item={i} projects={projects} />)}{!items.length ? <Empty>当前筛选下没有线索。可提交公告或处理已采集的材料。</Empty> : null}</div>
  </AdminPage>;
}
