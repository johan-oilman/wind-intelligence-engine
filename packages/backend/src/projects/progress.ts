import type { WindHistoryEvent, WindProgress, WindProjectInput } from "@aihot/contracts/wind";
import { sql, type Db } from "../db.ts";
import { inputDigest, matchProjects, WindError } from "./rules.ts";

// Rules and project-discovery notes are context, not a project's engineering progress.
export function isProgressEvent(e: WindHistoryEvent) {
  return !["历史监控范围恢复", "重点项目线索"].includes(e.eventType) && Boolean(e.summary);
}
export async function relinkProgressIn(db: Db, projects: WindProjectInput[]) {
  const pool = projects.filter(p => !p.id.startsWith("DEMO-")).map(p => ({ ...p, enabled: true }));
  const rows = await db`SELECT id, events FROM wind_history`;
  const reviewed = new Set((await db`SELECT history_id, event_index FROM wind_progress_reviews`).map(r => `${r.history_id}:${r.event_index}`));
  for (const row of rows) for (const [index, e] of (row.events as WindHistoryEvent[]).entries()) {
    if (reviewed.has(`${row.id}:${index}`)) continue;
    await db`DELETE FROM wind_progress_targets WHERE history_id = ${row.id} AND event_index = ${index} AND method = 'name_match'`;
    if (!isProgressEvent(e)) continue;
    const matches = matchProjects(e.projectHint, pool);
    // A report-level association cannot decide which project an individual event belongs to.
    if (matches.length !== 1) continue;
    for (const id of matches) await db`INSERT INTO wind_progress_targets (history_id, event_index, project_id, method)
      VALUES (${row.id}, ${index}, ${id}, 'name_match') ON CONFLICT DO NOTHING`;
  }
}
function eventKey(e: WindHistoryEvent) {
  let source = e.sourceUrl;
  if (source) {
    const url = new URL(source); url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key)) url.searchParams.delete(key);
    source = url.href;
  }
  // Keep separate stages from the same notice; unknown dates do not imply the same event.
  return inputDigest(source ? [source, e.eventType, e.eventDate ?? e.summary] : [e.eventType, e.eventDate, e.summary]);
}
function progressType(e: WindHistoryEvent) {
  if (/中标/.test(e.eventType) && /中标候选/.test(e.summary) && !/正式中标|中标结果(?:已|公告|确定)/.test(e.summary)) return "中标候选人公示";
  if (/核准/.test(e.eventType) && /核准.*变更前公示/.test(e.summary)) return "核准变更前公示";
  if (/核准/.test(e.eventType) && /核准.*批复前公示/.test(e.summary)) return "核准前公示";
  if (/用海/.test(e.eventType) && /公示/.test(e.summary) && !/获.*批复|已.*批复/.test(e.summary)) return "用海公示";
  return e.eventType;
}
export async function windProgress(projectIds: string[]): Promise<WindProgress[]> {
  if (!projectIds.length) return [];
  const rows = await sql`SELECT h.id, h.origin, h.title, h.notification, h.source_at, h.events -> t.event_index AS event,
    t.event_index, t.project_id, t.method FROM wind_progress_targets t JOIN wind_history h ON h.id = t.history_id
    WHERE t.project_id = ANY(${projectIds}) ORDER BY h.imported_at, h.id, t.event_index`;
  const groups = new Map<string, WindProgress>();
  for (const r of rows) {
    const raw = r.event as WindHistoryEvent;
    const event = raw ? { ...raw, eventType: progressType(raw) } : null;
    if (!event || !isProgressEvent(event)) continue;
    const key = eventKey(event), id = `${r.project_id}:${key}`;
    const item: WindProgress = groups.get(id) ?? { ...event, key, projectId: r.project_id, records: [] };
    item.records.push({ historyId: r.id, eventIndex: r.event_index, title: r.title, origin: r.origin, notification: r.notification,
      sourceAt: r.source_at ? new Date(r.source_at).toISOString() : null, method: r.method });
    groups.set(id, item);
  }
  return [...groups.values()].sort((a, b) => (b.eventDate ?? "").localeCompare(a.eventDate ?? "") || a.key.localeCompare(b.key));
}
export async function progressInbox() {
  const rows = await sql`SELECT h.id, h.title, h.origin, h.events, h.source_at FROM wind_history h
    WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(h.events) WITH ORDINALITY e(value, n)
      WHERE NOT EXISTS (SELECT 1 FROM wind_progress_targets t WHERE t.history_id = h.id AND t.event_index = e.n - 1)
      AND NOT EXISTS (SELECT 1 FROM wind_progress_reviews r WHERE r.history_id = h.id AND r.event_index = e.n - 1))
    ORDER BY h.imported_at DESC LIMIT 500`;
  const targets = new Set((await sql`SELECT DISTINCT history_id, event_index FROM wind_progress_targets
    UNION SELECT history_id, event_index FROM wind_progress_reviews`).map(r => `${r.history_id}:${r.event_index}`));
  return rows.flatMap(r => (r.events as WindHistoryEvent[]).flatMap((e, eventIndex) =>
    !isProgressEvent(e) || targets.has(`${r.id}:${eventIndex}`) ? [] : [{ ...e, historyId: r.id as string, eventIndex, recordTitle: r.title as string }]));
}
export async function linkProgress(historyId: string, eventIndex: number, input: { projectIds?: unknown }, actor: string) {
  if (!Number.isInteger(eventIndex) || eventIndex < 0 || !Array.isArray(input.projectIds) || input.projectIds.length > 100 || input.projectIds.some(id => typeof id !== "string")) throw new WindError("事件归属格式无效");
  const ids = [...new Set(input.projectIds as string[])];
  return sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('wind-history-import'))`;
    const [r] = await tx`SELECT events FROM wind_history WHERE id = ${historyId} FOR UPDATE`;
    if (!r || !r.events[eventIndex]) throw new WindError("跟进事件不存在");
    if (!isProgressEvent(r.events[eventIndex])) throw new WindError("监控规则或项目发现线索不属于工程进展");
    for (const id of ids) { const [p] = await tx`SELECT id FROM wind_projects WHERE id = ${id} AND id NOT LIKE 'DEMO-%'`; if (!p) throw new WindError("请选择底表内的项目"); }
    const before = await tx`SELECT project_id FROM wind_progress_targets WHERE history_id = ${historyId} AND event_index = ${eventIndex}`;
    await tx`DELETE FROM wind_progress_targets WHERE history_id = ${historyId} AND event_index = ${eventIndex}`;
    await tx`INSERT INTO wind_progress_reviews (history_id, event_index) VALUES (${historyId}, ${eventIndex}) ON CONFLICT DO NOTHING`;
    for (const id of ids) await tx`INSERT INTO wind_progress_targets (history_id, event_index, project_id, method) VALUES (${historyId}, ${eventIndex}, ${id}, 'manual')`;
    await tx`INSERT INTO audit_log (actor, action, subject, reason, before, after) VALUES (${actor}, 'wind.progress.link', ${`wind-history:${historyId}:event:${eventIndex}`}, '逐事件确认项目归属；不修改原文、当前事实或发送通知', ${tx.json(before as never)}, ${tx.json(ids)})`;
    return { projectIds: ids };
  });
}
