import type { WindEvidence } from "@aihot/contracts/wind";
import type { Route } from "./+types/wind-evidence-detail";
import { adminGet } from "../../lib/admin.server";
import { AdminPage, ButtonLink, Card, KV } from "../../features/admin/ui";

export async function loader({ request, params }: Route.LoaderArgs) { return adminGet<WindEvidence>(request, `/api/admin/wind/evidence/${params.evidenceId}`); }
export default function EvidenceDetail({ loaderData: e }: Route.ComponentProps) {
  return <AdminPage title={e.title} subtitle="保存的证据快照，仅管理员可访问。网页后续变化不会改写本快照。" actions={<ButtonLink to="/admin/wind/review">返回复核</ButtonLink>}>
    <Card title="来源信息"><KV items={[["发布者", e.publisher], ["来源等级", e.tier], ["公告日期", e.publishedAt ? new Date(e.publishedAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : "未知"], ["发现时间", new Date(e.discoveredAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })], ["原文", <a href={e.url} target="_blank" rel="noreferrer" className="text-accent">{e.url}</a>]]} /></Card>
    <div className="mt-5"><Card title="原文 / 附件文字"><pre className="whitespace-pre-wrap break-words font-sans text-[14px] leading-7 text-ink-2">{e.body}</pre></Card></div>
  </AdminPage>;
}
