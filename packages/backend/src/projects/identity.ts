import type { WindHistoryEvent, WindProgressResolution, WindProjectInput } from "@aihot/contracts/wind";
import { matchProjects } from "./rules.ts";

export interface ProgressIdentity { projectNames: string[]; reason: string; evidenceUrl: string }
/** Names identify ownership; capacity, developer and geographic resemblance alone do not. */
export function classifyProgress(e: WindHistoryEvent, projects: WindProjectInput[], identity?: ProgressIdentity): WindProgressResolution {
  const pool = projects.filter(p => !p.id.startsWith("DEMO-")).map(p => ({ ...p, enabled: true }));
  const groups = identity?.projectNames.map(name => matchProjects(name, pool));
  const ids = [...new Set(groups ? groups.flat() : matchProjects(e.projectHint, pool))];
  const evidenceUrl = identity?.evidenceUrl ?? e.sourceUrl;
  if (groups ? groups.every(g => g.length === 1) : ids.length === 1) return { kind: "matched", projectIds: ids,
    projectNames: ids.map(id => pool.find(p => p.id === id)!.name), reason: identity?.reason ?? "名称唯一对应到底表项目，可以自动关联。", evidenceUrl };
  if (!identity && e.eventType === "政策变化" && /全国|规划|产业|政策|十五五/.test(e.projectHint)) return {
    kind: "policy", projectIds: [], projectNames: [], reason: "区域或行业政策，作为监控背景保留，不属于某一个项目的工程节点。", evidenceUrl };
  if (identity && groups!.some(g => g.length === 0)) return { kind: "missing_project", projectIds: ids, projectNames: identity.projectNames,
    reason: `${identity.reason} 对应项目尚未全部收入底表；补入后自动重新关联。`, evidenceUrl };
  if (ids.length > 1) return { kind: "needs_review", projectIds: ids, projectNames: ids.map(id => pool.find(p => p.id === id)!.name),
    reason: "名称涉及多个项目，需要核对这条节点是联合工程还是仅属于其中一个项目。", evidenceUrl };
  const name = e.projectHint.split(/[，,；;]/)[0].trim();
  if (/海上风电(?:场)?(?:示范)?项目$|海上风电场$/.test(name) && !/具体项目|未披露|省内|总规模|在.*开发的|约\d/.test(name)) return {
    kind: "missing_project", projectIds: [], projectNames: [name], reason: "原记录已写明具体项目名称，但当前底表没有该项目；项目状态仍待原公告核验。", evidenceUrl };
  return { kind: "unknown", projectIds: [], projectNames: [], reason: "缺少正式项目名或明确场址，需要读取原文补齐身份；不会只按容量猜测归属。", evidenceUrl };
}
