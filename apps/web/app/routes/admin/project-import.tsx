import type { WindImportPreview } from "@aihot/contracts/wind";
import { useState } from "react";
import { useAdminAction } from "../../features/admin/action";
import { PROJECT_TEMPLATE } from "../../features/admin/wind";
import { AdminPage, Button, ButtonLink, Card, DataTable, Field, Textarea } from "../../features/admin/ui";

export default function ProjectImport() {
  const { run, busy } = useAdminAction(); const [csv, setCsv] = useState(""); const [preview, setPreview] = useState<WindImportPreview | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const changeCsv = (text: string) => { setCsv(text); setPreview(null); setResult(null); };
  return <AdminPage title="导入项目底表" subtitle="先预览差异，再确认写入。相同 ID 对应同一项目；空容量、主体和区域不覆盖已记录值。" actions={<ButtonLink to="/admin/projects">返回底表</ButtonLink>}>
    <Card title="CSV 内容" right={<Button onClick={() => changeCsv(PROJECT_TEMPLATE)}>填入示例</Button>}>
      <p className="mb-3 text-[13px] text-ink-3">必填列 id、name。可选 province、city、developer、capacityMw、aliases、priority。别名用分号分隔；容量支持 MW、万千瓦等单位。</p>
      <label className="mb-3 block text-[13px] text-ink-2">选择 CSV 文件 <input aria-label="选择 CSV 文件" type="file" accept=".csv,text/csv" className="mt-1 block" onChange={async e => { const file = e.target.files?.[0]; if (file && file.size <= 2_000_000) changeCsv(await file.text()); else if (file) setResult("文件不能超过 2 MB"); }} /></label>
      <Field label="项目 CSV"><Textarea aria-label="项目 CSV" rows={10} value={csv} onChange={e => changeCsv(e.target.value)} placeholder="id,name,capacityMw,aliases,priority" spellCheck={false} /></Field>
      <div className="mt-3 flex justify-end"><Button tone="primary" disabled={busy || !csv.trim()} onClick={async () => { const r = await run<WindImportPreview>("POST", "/api/admin/wind/import/preview", { csv }, { revalidate: false }); if (r) setPreview(r); }}>预览差异</Button></div>
    </Card>
    {preview ? <div className="mt-5"><Card title="导入预览">
      {preview.errors.length ? <ul className="list-inside list-disc text-[13px] text-hot">{preview.errors.map(e => <li key={e}>{e}</li>)}</ul> : <DataTable rows={preview.changes} rowKey={p => p.id} columns={[
        { key: "id", label: "ID", render: p => p.id }, { key: "name", label: "项目", render: p => p.name },
        { key: "action", label: "动作", render: p => ({ create: "新建", update: "更新参考底表", unchanged: "不变" })[p.action] },
      ]} />}
      <div className="mt-4 flex justify-end"><Button tone="primary" disabled={busy || !preview.token || !!preview.errors.length} onClick={async () => {
        const r = await run<{ created: number; updated: number; unchanged: number }>("POST", "/api/admin/wind/import/commit", { csv, token: preview.token }, { success: "项目底表已保存" });
        if (r) { setResult(`新建 ${r.created} 个，更新 ${r.updated} 个，不变 ${r.unchanged} 个。`); setPreview(null); }
      }}>确认导入</Button></div>
    </Card></div> : null}
    {result ? <div role="status" className="mt-4 rounded-panel bg-accent-soft p-4 text-[13px] text-accent">{result}</div> : null}
  </AdminPage>;
}
