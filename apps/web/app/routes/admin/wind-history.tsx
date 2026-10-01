import type { WindProgressInboxEntry } from "@aihot/contracts/wind";
import { Link } from "react-router";
import type { Route } from "./+types/wind-history";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { AdminPage, Button, ButtonLink, Card, DataTable, Stat } from "../../features/admin/ui";
const labels = { matched: "可自动关联", missing_project: "底表缺项目", policy: "政策背景", needs_review: "涉及多个项目", unknown: "需补项目身份" };
export async function loader({ request }: Route.LoaderArgs) { return adminGet<{ rows: WindProgressInboxEntry[] }>(request, "/api/admin/wind/progress/inbox"); }
export default function ProgressInbox({ loaderData: { rows } }: Route.ComponentProps) {
  const { run, busy } = useAdminAction();
  const counts = { missing_project: 0, policy: 0, needs_review: 0, unknown: 0, matched: 0 };
  for (const row of rows) counts[row.resolution.kind]++;
  return <AdminPage title="待归属进展" subtitle="系统自动识别底表缺项、政策背景和身份不明。底表内名称唯一的进展自动关联；新项目先列出候选，补入底表后重新匹配。" actions={<><ButtonLink to="/admin/projects">返回项目底表</ButtonLink><Button disabled={busy} onClick={() => run("POST", "/api/admin/wind/history/relink", {}, { success: "已按项目底表重新匹配进展" })}>按底表重新匹配</Button></>}>
    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="底表缺项目" value={counts.missing_project} /><Stat label="政策背景" value={counts.policy} /><Stat label="需核对多个项目" value={counts.needs_review} /><Stat label="需补项目身份" value={counts.unknown} /></div>
    <Card title={`待归属事件 · ${rows.length}`}><DataTable rows={rows} rowKey={e => `${e.historyId}:${e.eventIndex}`} empty="当前没有待归属事件。已归属的进展请到对应项目查看。" columns={[
      { key: "hint", label: "原记录中的项目", render: e => e.projectHint },
      { key: "resolution", label: "自动识别结果", render: e => <div className="min-w-64 max-w-sm"><strong>{labels[e.resolution.kind]}</strong>{e.resolution.projectNames.length ? <p className="mt-1 text-[13px]">{e.resolution.projectNames.join("；")}</p> : null}<p className="mt-1 text-[13px] text-ink-3">{e.resolution.reason}</p>{e.resolution.evidenceUrl ? <a className="mt-1 inline-block text-[13px] text-accent" href={e.resolution.evidenceUrl} target="_blank" rel="noreferrer">识别依据</a> : null}</div> },
      { key: "date", label: "事件日期", render: e => e.eventDate ?? "待补" },
      { key: "event", label: "跟进节点", render: e => <><strong>{e.eventType || "项目进展"}</strong><p className="mt-1 max-w-xl text-[13px] text-ink-3">{e.summary}</p></> },
      { key: "assign", label: "处理", render: e => <div className="flex flex-col gap-2">{e.resolution.kind === "missing_project" ? <Link to="/admin/projects/import" className="text-accent">补入项目底表</Link> : null}<Link to={`/admin/wind/history/${e.historyId}#event-${e.eventIndex}`} className="text-accent">{e.resolution.kind === "policy" ? "查看政策原记录" : "查看原记录与归属"}</Link></div> },
    ]} /></Card>
  </AdminPage>;
}
