import { WIND_FIELDS, type WindCandidate, type WindChange, type WindFact, type WindProject } from "@aihot/contracts/wind";
import { useState } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/project-detail";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { kindLabel, scopeLabel } from "../../features/admin/wind";
import { AdminPage, Badge, Button, ButtonLink, Card, Field, Input, KV } from "../../features/admin/ui";

interface Detail { project: WindProject; facts: WindFact[]; candidates: WindCandidate[]; changes: WindChange[]; sources: Array<{ id: string; name: string }> }
export async function loader({ request, params }: Route.LoaderArgs) { return adminGet<Detail>(request, `/api/admin/wind/projects/${encodeURIComponent(params.projectId!)}`); }
export default function ProjectDetail({ loaderData: { project: p, facts, candidates, changes, sources } }: Route.ComponentProps) {
  const { run, busy } = useAdminAction(); const [sourceIds, setSourceIds] = useState<string | null>(null);
  const query = `${p.name} 核准 招标 中标 并网`;
  return <AdminPage title={p.name} subtitle={`${p.id} · ${p.id.startsWith("DEMO-") ? "示例项目，仅用于演示" : "项目事实与证据时间线"}`} actions={<><ButtonLink to="/admin/projects">返回底表</ButtonLink><ButtonLink to={`/admin/wind/evidence?projectId=${encodeURIComponent(p.id)}`} tone="primary">提交公告</ButtonLink></>}>
    <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
      <div className="space-y-5"><Card title="已确认事实" right={<Badge tone="ok">复核后更新</Badge>}>
        {facts.length ? <div className="grid gap-3 sm:grid-cols-2">{facts.map(f => <div key={`${f.field}:${f.scope}`} className="rounded-card bg-bg-sunk/60 p-3"><div className="text-[12px] text-ink-3">{WIND_FIELDS[f.field]} · {scopeLabel(f.scope)}</div><div className="mt-1 text-[16px] font-semibold text-ink">{String(f.value)}{f.field === "capacityMw" ? " MW" : ""}</div><div className="mt-1 text-[12px] text-ink-3">事件日期：{f.eventDate ?? "原文未明确"} · <Link to={`/admin/wind/evidence/${f.evidenceId}`} className="text-accent">证据</Link></div></div>)}</div> : <p className="text-[13px] text-ink-3">尚无已确认事实。导入参考数据不会自动变成已核实状态。</p>}
      </Card>
      <Card title={`待复核线索 · ${candidates.filter(c => c.status === "pending").length}`} right={<Link to={`/admin/wind/review?projectId=${encodeURIComponent(p.id)}`} className="text-accent">前往复核</Link>}>
        {candidates.filter(c => c.status === "pending").map(c => <div key={c.id} className="border-b border-line py-3 text-[13px] last:border-0"><strong>{WIND_FIELDS[c.field]}：{String(c.value)}</strong><div className="mt-1 text-ink-3">{scopeLabel(c.scope)} · {c.title}</div></div>)}
        {!candidates.some(c => c.status === "pending") ? <p className="text-[13px] text-ink-3">当前没有待复核线索。</p> : null}
      </Card>
      <Card title="变化时间线" right={<Link to={`/admin/wind/history?projectId=${encodeURIComponent(p.id)}`} className="text-accent">历史监控与邮件</Link>}><ol className="space-y-4">{changes.map(c => <li key={c.id} className="border-l-2 border-accent pl-4 text-[13px] text-ink-2"><div className="flex flex-wrap gap-2"><strong>{WIND_FIELDS[c.field]}：{c.before ?? "未记录"} → {String(c.after)}</strong><Badge tone={c.applied ? "accent" : "muted"}>{kindLabel[c.kind]}</Badge></div><div className="mt-1 text-ink-3">{scopeLabel(c.scope)} · 事件 {c.eventDate ?? "日期未知"} · 确认 {new Date(c.confirmedAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}</div><blockquote className="mt-2 whitespace-pre-wrap">{c.quote}</blockquote><p className="mt-1 text-ink-3">复核依据：{c.reason}</p><Link to={`/admin/wind/evidence/${c.evidenceId}`} className="mt-1 inline-block text-accent">{c.title}</Link></li>)}</ol>{!changes.length ? <p className="text-[13px] text-ink-3">复核确认后，历史记录会保存在这里。</p> : null}</Card>
      </div>
      <div className="space-y-5"><Card title="导入参考底表"><KV items={[["区域", `${p.province} ${p.city}`], ["参考主体", p.developer], ["参考容量", p.capacityMw ? `${p.capacityMw} MW` : null], ["关注等级", p.priority === "high" ? "重点" : "常规"], ["别名", p.aliases.join("；") || "未填写"]]} /></Card>
        <Card title="监控信源"><p className="mb-2 text-[12px] text-ink-3">先在信源管理中创建来源，再绑定到项目。绑定不会自动发布项目数据。</p>{sources.map(s => <Link key={s.id} to={`/admin/sources/${encodeURIComponent(s.id)}`} className="mb-2 block text-[13px] text-accent">{s.name}</Link>)}<Field label="信源 ID，逗号分隔"><Input aria-label="监控信源 ID" value={sourceIds ?? sources.map(s => s.id).join(",")} onChange={e => setSourceIds(e.target.value)} placeholder="交易平台信源 ID" /></Field><Button className="mt-3" disabled={busy} onClick={async () => { const r = await run("POST", `/api/admin/wind/projects/${encodeURIComponent(p.id)}/sources`, { sourceIds: (sourceIds ?? sources.map(s => s.id).join(",")).split(/[,，]/).map(s => s.trim()).filter(Boolean), version: p.version }, { success: "监控来源已保存" }); if (r) setSourceIds(null); }}>保存来源</Button></Card>
        <Card title="主动搜索词"><p className="break-words text-[13px] text-ink-2">{query}</p><p className="mt-2 text-[12px] text-ink-3">当前提供人工搜索入口；自动搜索适配器尚未接入。</p><a href={`https://www.baidu.com/s?${new URLSearchParams({ wd: query })}`} target="_blank" rel="noreferrer" className="mt-3 inline-block text-[13px] text-accent">搜索项目线索</a></Card>
      </div>
    </div>
  </AdminPage>;
}
