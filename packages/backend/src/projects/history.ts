import { randomUUID } from "node:crypto";
import type { WindHistoryEvent, WindHistoryRecord } from "@aihot/contracts/wind";
import { sql, type Db } from "../db.ts";
import { dateOnly, inputDigest, matchProjects, safeEvidenceUrl, WindError } from "./rules.ts";
import { listWindProjects } from "./service.ts";
import { relinkProgressIn } from "./progress.ts";

function text(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function url(value: unknown) { return value ? safeEvidenceUrl(value) : null; }
function archiveUrl(value: unknown) {
  if (!value) return null;
  // Mail and conversation archives use fragments to locate the original record.
  const validated = safeEvidenceUrl(value);
  const result = new URL(validated); result.hash = new URL(value as string).hash;
  return result.href;
}
/** Extract JSON objects without treating a report's prose, instructions or HTML as executable. */
export function parseHistoryEvents(body: string): { events: WindHistoryEvent[]; note: string } {
  const objects: Record<string, unknown>[] = [];
  let start = -1, depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (start < 0) { if (c === "{") { start = i; depth = 1; } continue; }
    if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try { const value = JSON.parse(body.slice(start, i + 1)); if (value && typeof value === "object" && value.project_hint && value.summary) objects.push(value); } catch { /* Raw text is retained for manual review. */ }
      start = -1;
    }
  }
  let invalid = false;
  const events = objects.map(o => {
    let eventDate: string | null = null, sourceUrl: string | null = null;
    try { eventDate = dateOnly(o.event_date); } catch { invalid = true; }
    try { sourceUrl = url(o.source_url); } catch { invalid = true; }
    return { projectHint: text(o.project_hint, 2000), eventType: text(o.event_type, 200), eventDate,
      summary: text(o.summary, 10000), sourceName: text(o.source_name, 1000), sourceUrl,
      risk: text(o.risk, 4000), suggestedStage: text(o.suggested_stage, 1000) };
  });
  const unique = [...new Map(events.map(e => [inputDigest(e), e])).values()].slice(0, 100);
  return { events: unique, note: !unique.length ? "未识别结构化事件，已保留完整记录" : invalid ? "部分日期或链接无效，已保留原文供核对" : "历史通知摘要；原公告尚需核对，不作为已确认事实" };
}
export interface HistoryInput { origin?: unknown; externalId?: unknown; archiveUrl?: unknown; title?: unknown; body?: unknown; sourceAt?: unknown; sentRecord?: unknown }
function parseInput(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new WindError("历史记录格式无效");
  const input = raw as HistoryInput;
  if (!["gmail", "conversation", "file"].includes(String(input.origin))) throw new WindError("历史来源类型无效");
  for (const [label, value, max] of [["外部 ID", input.externalId, 500], ["标题", input.title, 1000], ["正文", input.body, 200000]] as const)
    if (typeof value !== "string" || !value.trim() || value.length > max) throw new WindError(`${label}不能为空且需少于 ${max} 字`);
  let sourceAt: Date | null = null;
  if (input.sourceAt) {
    if (typeof input.sourceAt !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.sourceAt)) throw new WindError("历史记录时间必须包含时区");
    sourceAt = new Date(input.sourceAt); if (!Number.isFinite(sourceAt.getTime())) throw new WindError("历史时间无效");
  }
  const body = input.body as string;
  const notification = input.origin === "gmail" && input.sentRecord === true ? "sent_record" :
    input.origin === "conversation" && /未实际(?:外发|发送)|未发送|未启用|邮件.*(?:不可用|未启用)|邮件通道不可用|通知及邮件投递不可用/.test(body) ? "not_sent" : "unknown";
  return { origin: String(input.origin), externalId: (input.externalId as string).trim(), archiveUrl: archiveUrl(input.archiveUrl), title: (input.title as string).trim(), body, sourceAt, notification, ...parseHistoryEvents(body) };
}
export async function importWindHistory(input: { records?: unknown }, actor: string) {
  if (!Array.isArray(input.records) || !input.records.length || input.records.length > 500) throw new WindError("每次需导入 1–500 条历史记录");
  const records = input.records.map(parseInput);
  return sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('wind-history-import'))`;
    let created = 0, repeated = 0;
    for (const r of records) {
      const hash = inputDigest({ ...r, sourceAt: r.sourceAt?.toISOString() ?? null });
      const [existing] = await tx`SELECT id, content_hash FROM wind_history WHERE origin = ${r.origin} AND external_id = ${r.externalId}`;
      if (existing) {
        if (existing.content_hash !== hash) throw new WindError("同一历史记录的内容发生变化；请使用新版本 ID，原记录不会覆盖", true);
        repeated++; continue;
      }
      const id = randomUUID();
      await tx`INSERT INTO wind_history (id, origin, external_id, archive_url, title, body, content_hash, source_at, events, parse_note, notification)
        VALUES (${id}, ${r.origin}, ${r.externalId}, ${r.archiveUrl}, ${r.title}, ${r.body}, ${hash}, ${r.sourceAt}, ${tx.json(r.events as never)}, ${r.note}, ${r.notification})`;
      created++;
    }
    await relinkWindHistoryIn(tx);
    await tx`INSERT INTO audit_log (actor, action, subject, reason, after) VALUES (${actor}, 'wind.history.import', 'wind-history', '导入历史记录，不修改当前事实、不重发通知', ${tx.json({ created, repeated })})`;
    return { created, repeated };
  });
}
async function relinkWindHistoryIn(db: Db) {
  const projects = (await listWindProjects("", db)).map(p => ({ ...p, enabled: true }));
  const rows = await db`SELECT id, events FROM wind_history WHERE NOT link_reviewed`;
  let linked = 0;
  for (const row of rows) {
    const matches = new Set((row.events as WindHistoryEvent[]).flatMap(e => matchProjects(e.projectHint, projects)));
    // Refresh suggested matches only; a manual association always survives registry changes.
    await db`DELETE FROM wind_history_projects WHERE history_id = ${row.id} AND method = 'name_match'`;
    for (const id of matches) {
      await db`INSERT INTO wind_history_projects (history_id, project_id, method) VALUES (${row.id}, ${id}, 'name_match') ON CONFLICT DO NOTHING`;
      linked++;
    }
  }
  await relinkProgressIn(db, projects);
  return { linked };
}
export async function relinkWindHistory(actor: string) {
  return sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('wind-history-import'))`;
    const result = await relinkWindHistoryIn(tx);
    await tx`INSERT INTO audit_log (actor, action, subject, reason, after) VALUES (${actor}, 'wind.history.relink', 'wind-history', '按现有底表匹配历史项目名称，仅建议关联', ${tx.json(result)})`;
    return result;
  });
}
function record(r: Record<string, any>): WindHistoryRecord {
  return { id: r.id, origin: r.origin, externalId: r.external_id, archiveUrl: r.archive_url, title: r.title, body: r.body,
    sourceAt: r.source_at ? new Date(r.source_at).toISOString() : null, importedAt: new Date(r.imported_at).toISOString(),
    events: r.events, parseNote: r.parse_note, notification: r.notification, projects: r.projects ?? [], eventProjects: r.event_projects ?? [] };
}
export async function windHistory(q = "", projectId: string | null = null, id: string | null = null) {
  const search = q.trim() ? `%${q.trim().slice(0, 200)}%` : null;
  const rows = await sql`SELECT h.*, coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'method', t.method) ORDER BY p.name)
    FROM wind_history_projects t JOIN wind_projects p ON p.id = t.project_id WHERE t.history_id = h.id), '[]'::jsonb) AS projects
    , coalesce((SELECT jsonb_agg(jsonb_build_object('eventIndex', t.event_index, 'projectId', p.id, 'projectName', p.name, 'method', t.method))
      FROM wind_progress_targets t JOIN wind_projects p ON p.id = t.project_id WHERE t.history_id = h.id), '[]'::jsonb) AS event_projects
    FROM wind_history h WHERE (${id}::text IS NULL OR h.id = ${id}) AND (${search}::text IS NULL OR h.title ILIKE ${search} OR h.events::text ILIKE ${search} OR h.body ILIKE ${search})
    AND (${projectId}::text IS NULL OR EXISTS (SELECT 1 FROM wind_history_projects t WHERE t.history_id = h.id AND t.project_id = ${projectId})
      OR EXISTS (SELECT 1 FROM wind_progress_targets t WHERE t.history_id = h.id AND t.project_id = ${projectId}))
    ORDER BY h.source_at DESC NULLS LAST, h.imported_at DESC, h.id LIMIT 500`;
  return rows.map(record);
}
export async function windHistoryStats() {
  const [r] = await sql`SELECT count(*)::int AS records, count(*) FILTER (WHERE origin = 'gmail')::int AS emails,
    count(*) FILTER (WHERE notification = 'sent_record')::int AS sent,
    count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM wind_history_projects t WHERE t.history_id = wind_history.id))::int AS unlinked FROM wind_history`;
  return r;
}
export async function linkWindHistory(id: string, input: { projectIds?: unknown }, actor: string) {
  if (!Array.isArray(input.projectIds) || input.projectIds.length > 100 || input.projectIds.some(v => typeof v !== "string")) throw new WindError("关联项目需为 ID 数组");
  const ids = [...new Set(input.projectIds as string[])];
  return sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('wind-history-import'))`;
    const [exists] = await tx`SELECT id FROM wind_history WHERE id = ${id} FOR UPDATE`; if (!exists) throw new WindError("历史记录不存在");
    for (const projectId of ids) { const [p] = await tx`SELECT id FROM wind_projects WHERE id = ${projectId}`; if (!p) throw new WindError("关联项目不存在"); }
    await tx`DELETE FROM wind_history_projects WHERE history_id = ${id}`;
    await tx`UPDATE wind_history SET link_reviewed = true WHERE id = ${id}`;
    for (const projectId of ids) await tx`INSERT INTO wind_history_projects (history_id, project_id, method) VALUES (${id}, ${projectId}, 'manual')`;
    await tx`INSERT INTO audit_log (actor, action, subject, reason, after) VALUES (${actor}, 'wind.history.link', ${`wind-history:${id}`}, '人工关联历史记录，未确认原公告事实', ${tx.json(ids)})`;
    return { projectIds: ids };
  });
}
