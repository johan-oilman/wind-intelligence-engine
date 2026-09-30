import type { WindBrief } from "@aihot/contracts/wind";
import { Form } from "react-router";
import type { Route } from "./+types/wind-brief";
import { adminGet } from "../../lib/admin.server";
import { AdminPage, Card, Input } from "../../features/admin/ui";

export async function loader({ request }: Route.LoaderArgs) {
  const d = new URL(request.url).searchParams.get("day") ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  return adminGet<WindBrief>(request, `/api/admin/wind/brief?${new URLSearchParams({ day: d })}`);
}
export default function Brief({ loaderData: brief }: Route.ComponentProps) {
  const download = () => { const url = URL.createObjectURL(new Blob([brief.markdown], { type: "text/markdown;charset=utf-8" })); const a = document.createElement("a"); a.href = url; a.download = `wind-brief-${brief.day}.md`; a.click(); URL.revokeObjectURL(url); };
  return <AdminPage title="项目简报" subtitle="按北京时间 09:00 划分确认窗口，使用已复核变化。当前支持站内生成与下载，外部通知尚未启用。" actions={<button onClick={download} className="text-[13px] text-accent">下载 Markdown</button>}>
    <Form method="get" className="mb-5 flex max-w-sm gap-3"><Input aria-label="简报日期" type="date" name="day" defaultValue={brief.day} /><button className="shrink-0 text-[13px] text-accent">查看</button></Form>
    <Card title={`海上风电项目简报 · ${brief.day}`}><pre className="whitespace-pre-wrap break-words font-sans text-[14px] leading-7 text-ink-2">{brief.markdown}</pre></Card>
  </AdminPage>;
}
