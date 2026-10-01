import type { WindHistoryEvent } from "@aihot/contracts/wind";
import { Link } from "react-router";
import type { Route } from "./+types/wind-history";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { AdminPage, Button, ButtonLink, Card, DataTable } from "../../features/admin/ui";
type Entry = WindHistoryEvent & { historyId: string; eventIndex: number; recordTitle: string };
export async function loader({ request }: Route.LoaderArgs) { return adminGet<{ rows: Entry[] }>(request, "/api/admin/wind/progress/inbox"); }
export default function ProgressInbox({ loaderData: { rows } }: Route.ComponentProps) {
  const { run, busy } = useAdminAction();
  return <AdminPage title="待归属进展" subtitle="这里只处理尚未对应到底表项目的进展。选择具体项目后，记录进入该项目的跟进过程；不会根据邮件数量创建新项目。" actions={<><ButtonLink to="/admin/projects">返回项目底表</ButtonLink><Button disabled={busy} onClick={() => run("POST", "/api/admin/wind/history/relink", {}, { success: "已按项目底表重新匹配进展" })}>按底表重新匹配</Button></>}>
    <Card title={`待归属事件 · ${rows.length}`}><DataTable rows={rows} rowKey={e => `${e.historyId}:${e.eventIndex}`} empty="当前没有待归属事件。已归属的进展请到对应项目查看。" columns={[
      { key: "hint", label: "原记录中的项目", render: e => e.projectHint },
      { key: "date", label: "事件日期", render: e => e.eventDate ?? "待补" },
      { key: "event", label: "跟进节点", render: e => <><strong>{e.eventType || "项目进展"}</strong><p className="mt-1 max-w-xl text-[13px] text-ink-3">{e.summary}</p></> },
      { key: "assign", label: "处理", render: e => <Link to={`/admin/wind/history/${e.historyId}#event-${e.eventIndex}`} className="text-accent">选择底表项目</Link> },
    ]} /></Card>
  </AdminPage>;
}
