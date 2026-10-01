import { WIND_FIELDS, WIND_VALUES, type WindProject } from "@aihot/contracts/wind";
import { useState } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/wind-evidence";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { AdminPage, Button, ButtonLink, Card, Field, Input, Select, Textarea } from "../../features/admin/ui";

export async function loader({ request }: Route.LoaderArgs) { return { ...(await adminGet<{ rows: WindProject[] }>(request, "/api/admin/wind/projects")), projectId: new URL(request.url).searchParams.get("projectId") ?? "" }; }
export default function Evidence({ loaderData }: Route.ComponentProps) {
  const { run, busy } = useAdminAction();
  const [form, setForm] = useState({ url: "", title: "", publisher: "", body: "", tier: "T2", publishedAt: "" });
  const [manual, setManual] = useState(false);
  const [fact, setFact] = useState({ projectId: loaderData.projectId, field: "procurement", value: "招标", quote: "", scope: "project", eventDate: "" });
  const [result, setResult] = useState<{ evidenceId: string; created: number } | null>(null);
  const options = WIND_VALUES[fact.field as keyof typeof WIND_FIELDS];
  return <AdminPage title="提交公告" subtitle="保存原文或附件文字，生成待复核线索。当前采用保守的规则识别；复杂表述可人工录入事实候选。" actions={<ButtonLink to="/admin/wind/review">查看复核队列</ButtonLink>}>
    <Card title="原始证据"><div className="grid gap-4 sm:grid-cols-2">
      <Field label="原文网址"><Input aria-label="原文网址" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://…" /></Field>
      <Field label="公告标题"><Input aria-label="公告标题" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></Field>
      <Field label="原始发布者"><Input aria-label="原始发布者" value={form.publisher} onChange={e => setForm({ ...form, publisher: e.target.value })} placeholder="实际发布机构，非搜索工具名称" /></Field>
      <Field label="公告发布日期"><Input aria-label="公告发布日期" type="date" value={form.publishedAt} onInput={e => { const publishedAt = e.currentTarget.value; setForm(prev => ({ ...prev, publishedAt })); }} onChange={e => { const publishedAt = e.target.value; setForm(prev => ({ ...prev, publishedAt })); }} /></Field>
      <Field label="信源等级"><Select aria-label="信源等级" value={form.tier} onChange={e => setForm({ ...form, tier: e.target.value })}><option value="T2">媒体或待核实来源</option><option value="T1_5">当事方官方账号</option><option value="T1">官方一手公告</option></Select></Field>
    </div><div className="mt-4"><Field label="正文或附件文字"><Textarea aria-label="正文或附件文字" rows={9} value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} placeholder="粘贴与项目相关的完整原文，保留项目名、日期和标段信息" /></Field></div>
      <label className="mt-4 flex gap-2 text-[13px] text-ink-2"><input type="checkbox" checked={manual} onChange={e => setManual(e.target.checked)} />人工指定事实候选</label>
      {manual ? <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="项目"><Select aria-label="候选项目" value={fact.projectId} onChange={e => setFact({ ...fact, projectId: e.target.value })}><option value="">请选择</option>{loaderData.rows.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label="事实字段"><Select aria-label="事实字段" value={fact.field} onChange={e => setFact({ ...fact, field: e.target.value, value: WIND_VALUES[e.target.value as keyof typeof WIND_FIELDS]?.[0] ?? "" })}>{Object.entries(WIND_FIELDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></Field>
        <Field label="事实值">{options ? <Select aria-label="事实值" value={fact.value} onChange={e => setFact({ ...fact, value: e.target.value })}>{options.map(v => <option key={v}>{v}</option>)}</Select> : <Input aria-label="事实值" value={fact.value} onChange={e => setFact({ ...fact, value: e.target.value })} placeholder={fact.field === "capacityMw" ? "例如 600MW" : fact.field === "plannedGridDate" ? "YYYY-MM-DD" : "开发主体名称"} />}</Field>
        <Field label="适用范围"><Input aria-label="适用范围" value={fact.scope} onChange={e => setFact({ ...fact, scope: e.target.value })} placeholder="project 表示整个项目，其他填写具体分期或标段" /></Field>
        <Field label="事件日期"><Input aria-label="事件日期" type="date" value={fact.eventDate} onInput={e => { const eventDate = e.currentTarget.value; setFact(prev => ({ ...prev, eventDate })); }} onChange={e => { const eventDate = e.target.value; setFact(prev => ({ ...prev, eventDate })); }} /></Field>
        <Field label="证据原句"><Textarea aria-label="证据原句" rows={2} value={fact.quote} onChange={e => setFact({ ...fact, quote: e.target.value })} placeholder="必须是正文中的原句" /></Field>
      </div> : null}
      <div className="mt-5 flex justify-end"><Button tone="primary" disabled={busy || !form.url || !form.body || !form.title || !form.publisher || (manual && (!fact.projectId || !fact.quote))} onClick={async () => {
        const r = await run<{ evidenceId: string; created: number }>("POST", "/api/admin/wind/evidence", { ...form, ...(manual ? { candidate: fact } : {}) }, { success: "证据已保存", revalidate: false }); if (r) setResult(r);
      }}>保存并生成候选</Button></div>
    </Card>
    {result ? <div role="status" className="mt-4 rounded-panel bg-accent-soft p-4 text-[13px] text-accent">已保存证据，新增 {result.created} 条候选。{!result.created ? "重复提交不会重复生成；若规则未识别，可人工指定事实。" : ""}<div className="mt-2 flex gap-4"><Link to="/admin/wind/review">前往复核</Link><Link to={`/admin/wind/evidence/${result.evidenceId}`}>查看保存的证据</Link></div></div> : null}
  </AdminPage>;
}
