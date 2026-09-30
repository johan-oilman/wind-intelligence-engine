import { WIND_FIELDS, type WindCandidate, type WindProject } from "@aihot/contracts/wind";
import { useState } from "react";
import { Link } from "react-router";
import { useAdminAction } from "./action";
import { Badge, Button, Card, Field, Select, Textarea } from "./ui";

export const scopeLabel = (scope: string) => scope === "project" ? "整个项目" : scope;
export const kindLabel = { live: "新变化", supplement: "补发现", historical: "历史补充 / 事实相同", correction: "更正" };
export const COVERAGE_LABEL = { ok: "最近检查成功", failed: "检查失败", paused: "已暂停", unchecked: "尚未检查", overdue: "检查逾期" };
export const PROJECT_TEMPLATE = 'id,name,province,city,developer,capacityMw,aliases,priority\nDEMO-GD-001,示例粤东一期海上风电项目,广东,示例市,示例能源,50万千瓦,示例粤东一期项目,high\nDEMO-GD-002,示例粤东二期海上风电项目,广东,示例市,示例能源,600MW,示例粤东二期项目,normal';

export function CandidateCard({ item, projects }: { item: WindCandidate; projects: WindProject[] }) {
  const { run, busy } = useAdminAction();
  const [projectId, setProjectId] = useState(item.projectId ?? "");
  const [mode, setMode] = useState("current");
  const [reason, setReason] = useState("");
  const p = projects.find(p => p.id === projectId);
  const accept = () => run("POST", `/api/admin/wind/candidates/${item.id}/review`, { decision: "accept", projectId, projectVersion: p?.version, mode, reason }, { success: "已确认并保存证据记录" });
  return <Card title={<span>{item.projectName ?? "项目归属待确认"} · {WIND_FIELDS[item.field]}</span>} right={<Badge tone={item.status === "pending" ? "warn" : item.status === "accepted" ? "ok" : "muted"}>{item.status === "pending" ? "待复核" : item.status === "accepted" ? "已确认" : "已排除"}</Badge>}>
    <div className="flex flex-wrap items-center gap-2 text-[13px]"><strong className="text-ink">{String(item.value)}</strong><Badge>{scopeLabel(item.scope)}</Badge>{item.planned ? <Badge tone="warn">计划表述</Badge> : null}<span className="text-ink-3">事件日期：{item.eventDate ?? "未明确"}</span></div>
    <blockquote className="my-3 whitespace-pre-wrap break-words border-l-2 border-accent bg-bg-sunk/60 p-3 text-[13px] leading-relaxed text-ink-2">{item.quote}</blockquote>
    <div className="text-[12.5px] text-ink-3">{item.publisher} · {item.tier} · 公告日期 {item.publishedAt ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai" }).format(new Date(item.publishedAt)) : "未知"}</div>
    <div className="mt-1 flex flex-wrap gap-4 text-[13px]"><a href={item.url} target="_blank" rel="noreferrer" className="text-accent">查看原文</a><Link to={`/admin/wind/evidence/${item.evidenceId}`} className="text-accent">查看保存的证据</Link></div>
    <p className="mt-2 text-[12px] text-ink-3">{item.note}</p>
    {item.status === "pending" ? <div className="mt-4 border-t border-line pt-4">
      <div className="grid gap-3 sm:grid-cols-2"><Field label="确认项目"><Select aria-label="确认项目" value={projectId} onChange={e => setProjectId(e.target.value)}><option value="">请选择项目</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label="保存方式"><Select aria-label="保存方式" value={mode} onChange={e => setMode(e.target.value)}><option value="current">更新当前事实（旧证据自动转历史）</option><option value="historical">只补充历史</option><option value="correction">正式更正当前事实</option></Select></Field></div>
      <div className="mt-3"><Field label="复核依据"><Textarea aria-label="复核依据" rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="说明项目归属、时间与标段口径为何成立" /></Field></div>
      <div className="mt-3 flex flex-wrap justify-end gap-2"><Button disabled={busy || !reason.trim()} onClick={() => run("POST", `/api/admin/wind/candidates/${item.id}/review`, { decision: "reject", reason }, { success: "已排除，保留复核记录" })}>排除线索</Button><Button tone="primary" disabled={busy || !p || !reason.trim()} onClick={accept}>确认并保存</Button></div>
    </div> : null}
  </Card>;
}
