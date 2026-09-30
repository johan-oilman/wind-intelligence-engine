import { randomUUID } from "node:crypto";
import type { WindBrief, WindCandidate, WindChange, WindCoverage, WindEvidence, WindFact, WindImportPreview, WindOverview, WindProject, WindProjectInput } from "@aihot/contracts/wind";
import { WIND_FIELDS } from "@aihot/contracts/wind";
import { sql, type Db } from "../db.ts";
import { csvCell, dateOnly, extractWindRules, inputDigest, matchProjects, parseProjectImport, safeEvidenceUrl, scopeOf, validateFact, WIND_EXTRACTOR_VERSION, WindError } from "./rules.ts";

type Row = Record<string, any>;
const iso = (v: unknown): string | null => v ? new Date(v as string).toISOString() : null;
const day = (v: unknown): string | null => typeof v === "string" ? v.slice(0, 10) : iso(v)?.slice(0, 10) ?? null;
const project = (r: Row): WindProject => ({ id: r.id, name: r.name, province: r.province, city: r.city, developer: r.developer,
  capacityMw: r.capacity_mw, aliases: r.aliases, priority: r.priority, enabled: r.enabled, version: r.version, pending: r.pending ?? 0, updatedAt: iso(r.updated_at)! });
const candidate = (r: Row): WindCandidate => ({ id: r.id, projectId: r.project_id, projectName: r.project_name ?? null, matches: r.matches, evidenceId: r.evidence_id,
  field: r.field, scope: r.scope, value: r.value, quote: r.quote, eventDate: day(r.event_date), planned: r.planned, status: r.status, note: r.note,
  extractor: r.extractor, title: r.title, url: r.url, publisher: r.publisher, publishedAt: iso(r.published_at), discoveredAt: iso(r.discovered_at)!, tier: r.tier });
const change = (r: Row): WindChange => ({ id: r.id, projectId: r.project_id, projectName: r.project_name, candidateId: r.candidate_id,
  field: r.field, scope: r.scope, before: r.before_value, after: r.after_value, eventDate: day(r.event_date), confirmedAt: iso(r.confirmed_at)!, applied: r.applied,
  kind: r.kind, reason: r.reason, actor: r.actor, evidenceId: r.evidence_id, title: r.title, url: r.url, quote: r.quote });
async function trail(db: Db, actor: string, action: string, subject: string, reason: string, before: unknown, after: unknown) {
  await db`INSERT INTO audit_log (actor, action, subject, reason, before, after)
    VALUES (${actor}, ${action}, ${subject}, ${reason}, ${before === null ? null : db.json(before as never)}, ${after === null ? null : db.json(after as never)})`;
}
function requiredText(v: unknown, label: string, max: number): string {
  if (typeof v !== "string" || !v.trim() || v.length > max) throw new WindError(`${label}不能为空且不能超过 ${max} 字`);
  return v.trim();
}

export async function listWindProjects(q = "", db: Db = sql): Promise<WindProject[]> {
  const search = q.trim() ? `%${q.trim().slice(0, 200)}%` : null;
  const rows = await db`SELECT p.*, (SELECT count(*)::int FROM wind_candidates c WHERE c.project_id = p.id AND c.status = 'pending') AS pending
    FROM wind_projects p WHERE (${search}::text IS NULL OR p.name ILIKE ${search} OR p.id ILIKE ${search} OR array_to_string(p.aliases, ' ') ILIKE ${search})
    ORDER BY p.priority = 'high' DESC, p.name LIMIT 1000`;
  return rows.map(project);
}
export async function windOverview(): Promise<WindOverview> {
  const [r] = await sql`SELECT (SELECT count(*)::int FROM wind_projects) AS projects,
    (SELECT count(*)::int FROM wind_candidates WHERE status = 'pending') AS pending,
    (SELECT count(*)::int FROM wind_changes WHERE applied) AS confirmed,
    (SELECT count(*)::int FROM wind_candidates WHERE status = 'pending' AND project_id IS NULL) AS unresolved`;
  return r as unknown as WindOverview;
}
function mergedImport(input: WindProjectInput, before: WindProject | undefined): WindProjectInput {
  // Empty baseline cells never erase known metadata. Confirmed facts are in a different table.
  return before ? { ...input, province: input.province || before.province, city: input.city || before.city,
    developer: input.developer ?? before.developer, capacityMw: input.capacityMw ?? before.capacityMw,
    aliases: [...new Set([...before.aliases, ...input.aliases])].sort() } : input;
}
function meta(p: WindProjectInput): WindProjectInput {
  return { id: p.id, name: p.name, province: p.province, city: p.city, developer: p.developer, capacityMw: p.capacityMw, aliases: [...p.aliases].sort(), priority: p.priority, enabled: p.enabled };
}
async function previewIn(input: { csv?: unknown; projects?: unknown }, db: Db): Promise<WindImportPreview> {
  const parsed = parseProjectImport(input); if (parsed.errors.length) return { ...parsed, changes: [], token: null };
  const existing = new Map((await listWindProjects("", db)).map(p => [p.id, p]));
  const rows = parsed.rows.map(p => mergedImport(p, existing.get(p.id)));
  const changes = rows.map(p => {
    const old = existing.get(p.id);
    return { id: p.id, name: p.name, action: !old ? "create" as const : inputDigest(meta(old)) === inputDigest(meta(p)) ? "unchanged" as const : "update" as const, version: old?.version ?? null };
  });
  return { rows, errors: [], changes, token: inputDigest({ rows, changes }) };
}
export async function previewWindImport(input: { csv?: unknown; projects?: unknown }) { return previewIn(input, sql); }
export async function commitWindImport(input: { csv?: unknown; projects?: unknown; token?: unknown }, actor: string) {
  return sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('wind-project-import'))`;
    await tx`SELECT id FROM wind_projects ORDER BY id FOR UPDATE`;
    const preview = await previewIn(input, tx);
    if (preview.errors.length) throw new WindError(preview.errors.join("；"));
    if (!preview.token || input.token !== preview.token) throw new WindError("项目或导入内容已变化，请重新预览再导入", true);
    let created = 0; let updated = 0;
    for (const [i, p] of preview.rows.entries()) {
      const kind = preview.changes[i].action; if (kind === "unchanged") continue;
      const [before] = await tx`SELECT * FROM wind_projects WHERE id = ${p.id}`;
      await tx`INSERT INTO wind_projects (id, name, province, city, developer, capacity_mw, aliases, priority, enabled)
        VALUES (${p.id}, ${p.name}, ${p.province}, ${p.city}, ${p.developer}, ${p.capacityMw}, ${p.aliases}, ${p.priority}, ${p.enabled})
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, province = EXCLUDED.province, city = EXCLUDED.city,
          developer = EXCLUDED.developer, capacity_mw = EXCLUDED.capacity_mw, aliases = EXCLUDED.aliases,
          priority = EXCLUDED.priority, enabled = EXCLUDED.enabled, version = wind_projects.version + 1, updated_at = now()`;
      await trail(tx, actor, `wind.project.${kind}`, `wind-project:${p.id}`, "底表预览后导入", before ?? null, p);
      if (kind === "create") created++; else updated++;
    }
    return { created, updated, unchanged: preview.rows.length - created - updated };
  });
}
export async function windCandidates(status = "pending", projectId: string | null = null): Promise<WindCandidate[]> {
  if (!["pending", "accepted", "rejected", "all"].includes(status)) throw new WindError("复核状态无效");
  const rows = await sql`SELECT c.*, p.name AS project_name, e.title, e.url, e.publisher, e.published_at, e.discovered_at, e.tier
    FROM wind_candidates c JOIN wind_evidence e ON e.id = c.evidence_id LEFT JOIN wind_projects p ON p.id = c.project_id
    WHERE (${status} = 'all' OR c.status = ${status}) AND (${projectId}::text IS NULL OR c.project_id = ${projectId} OR ${projectId} = ANY(c.matches))
    ORDER BY c.created_at DESC, c.id LIMIT 500`;
  return rows.map(candidate);
}
async function changeRows(db: Db, projectId: string | null, from: Date | null = null, through: Date | null = null) {
  const rows = await db`SELECT ch.*, p.name AS project_name, c.evidence_id, c.quote, e.title, e.url
    FROM wind_changes ch JOIN wind_projects p ON p.id = ch.project_id JOIN wind_candidates c ON c.id = ch.candidate_id JOIN wind_evidence e ON e.id = c.evidence_id
    WHERE (${projectId}::text IS NULL OR ch.project_id = ${projectId})
      AND (${from}::timestamptz IS NULL OR ch.confirmed_at >= ${from}) AND (${through}::timestamptz IS NULL OR ch.confirmed_at < ${through})
    ORDER BY ch.confirmed_at DESC, ch.id LIMIT 500`;
  return rows.map(change);
}
export async function windProjectDetail(id: string) {
  const [row] = await sql`SELECT p.*, (SELECT count(*)::int FROM wind_candidates c WHERE c.project_id = p.id AND c.status = 'pending') AS pending FROM wind_projects p WHERE p.id = ${id}`;
  if (!row) return null;
  const [facts, candidates, changes, sources] = await Promise.all([
    sql`SELECT field, scope, value, event_date, change_id, evidence_id FROM wind_facts WHERE project_id = ${id} ORDER BY field, scope`,
    windCandidates("all", id), changeRows(sql, id), sql`SELECT s.id, s.name, s.kind FROM sources s JOIN wind_source_targets t ON t.source_id = s.id WHERE t.project_id = ${id} ORDER BY s.name`,
  ]);
  return { project: project(row), facts: facts.map(r => ({ field: r.field, scope: r.scope, value: r.value, eventDate: day(r.event_date), changeId: r.change_id, evidenceId: r.evidence_id })) as WindFact[], candidates, changes, sources: sources as unknown as Array<{ id: string; name: string; kind: string }> };
}
export async function getWindEvidence(id: string): Promise<WindEvidence | null> {
  const [r] = await sql`SELECT * FROM wind_evidence WHERE id = ${id}`;
  return r ? { id: r.id, url: r.url, title: r.title, publisher: r.publisher, body: r.body, tier: r.tier, publishedAt: iso(r.published_at), discoveredAt: iso(r.discovered_at)!, articleId: r.article_id, hash: r.content_hash } as WindEvidence : null;
}
export interface EvidenceInput {
  url?: unknown; title?: unknown; publisher?: unknown; body?: unknown; tier?: unknown; publishedAt?: unknown;
  candidate?: unknown;
}
function parseEvidence(input: EvidenceInput) {
  const url = safeEvidenceUrl(input.url), title = requiredText(input.title, "标题", 1000), publisher = requiredText(input.publisher, "原始发布者", 200), body = requiredText(input.body, "正文或附件文字", 200000);
  const tier = input.tier ?? "T2"; if (!["T1", "T1_5", "T2"].includes(String(tier))) throw new WindError("来源等级无效");
  let publishedAt: Date | null = null;
  if (input.publishedAt !== undefined && input.publishedAt !== null && input.publishedAt !== "") {
    const v = requiredText(input.publishedAt, "发布时间", 50);
    const date = dateOnly(v); publishedAt = new Date(`${date}T00:00:00+08:00`);
  }
  return { url, title, publisher, body, tier: String(tier), publishedAt };
}
async function evidenceIn(db: Db, e: ReturnType<typeof parseEvidence>, articleId: string | null = null) {
  const hash = inputDigest([e.title, e.publisher, e.body, e.tier, e.publishedAt?.toISOString() ?? null]);
  const [r] = await db`INSERT INTO wind_evidence (id, url, title, publisher, body, tier, published_at, article_id, content_hash)
    VALUES (${randomUUID()}, ${e.url}, ${e.title}, ${e.publisher}, ${e.body}, ${e.tier}, ${e.publishedAt}, ${articleId}, ${hash})
    ON CONFLICT (url, content_hash) DO UPDATE SET article_id = coalesce(wind_evidence.article_id, EXCLUDED.article_id) RETURNING id`;
  return r.id as string;
}
async function candidateIn(db: Db, evidenceId: string, c: ReturnType<typeof extractWindRules>[number], extractor: string) {
  const key = inputDigest([evidenceId, c.projectId, c.matches, c.field, c.scope, c.value, c.quote, c.eventDate, c.planned]);
  const [r] = await db`INSERT INTO wind_candidates (id, project_id, matches, evidence_id, field, scope, value, quote, event_date, planned, note, extractor, dedup_key)
    VALUES (${randomUUID()}, ${c.projectId}, ${c.matches}, ${evidenceId}, ${c.field}, ${c.scope}, ${db.json(c.value as never)}, ${c.quote}, ${c.eventDate}, ${c.planned}, ${c.note}, ${extractor}, ${key})
    ON CONFLICT (dedup_key) DO NOTHING RETURNING id`;
  return r?.id as string | undefined;
}
export async function submitWindEvidence(input: EvidenceInput, actor: string) {
  const e = parseEvidence(input);
  return sql.begin(async tx => {
    const evidenceId = await evidenceIn(tx, e); let created = 0;
    if (input.candidate) {
      if (typeof input.candidate !== "object" || Array.isArray(input.candidate)) throw new WindError("事实候选格式无效");
      const c = input.candidate as Record<string, unknown>;
      const projectId = requiredText(c.projectId, "项目 ID", 80);
      const [p] = await tx`SELECT id FROM wind_projects WHERE id = ${projectId}`; if (!p) throw new WindError("项目不存在");
      const quote = requiredText(c.quote, "证据原句", 4000);
      if (!e.body.includes(quote)) throw new WindError("证据原句必须出现在保存的正文中");
      const f = validateFact(c.field, c.value);
      if (["construction", "installation", "grid"].includes(f.field) && /计划|预计|拟于|将于|有望|尚未/.test(quote)) throw new WindError("证据为计划或未完成表述，不能录入已完成里程碑");
      if (c.planned === true && f.field !== "plannedGridDate") throw new WindError("计划表述只能保存为计划并网日期，不能作为已完成里程碑");
      const id = await candidateIn(tx, evidenceId, { projectId, matches: [projectId], ...f, scope: scopeOf(c.scope ?? "project"), quote, eventDate: dateOnly(c.eventDate), planned: f.field === "plannedGridDate", note: "人工录入，请复核证据与事实口径" }, "manual-v1");
      if (id) created++;
    } else {
      const projects = await listWindProjects("", tx);
      for (const c of extractWindRules(e.body, projects)) if (await candidateIn(tx, evidenceId, c, WIND_EXTRACTOR_VERSION)) created++;
    }
    await trail(tx, actor, "wind.evidence.submit", `wind-evidence:${evidenceId}`, "提交证据，生成待复核候选", null, { created, title: e.title });
    return { evidenceId, created };
  });
}
export interface ReviewInput { decision?: unknown; projectId?: unknown; projectVersion?: unknown; mode?: unknown; reason?: unknown }
export async function reviewWindCandidate(id: string, input: ReviewInput, actor: string) {
  const reason = requiredText(input.reason, "复核依据", 2000);
  if (!["accept", "reject"].includes(String(input.decision))) throw new WindError("复核动作无效");
  const mode = input.mode ?? "current"; if (!["current", "historical", "correction"].includes(String(mode))) throw new WindError("更新方式无效");
  return sql.begin(async tx => {
    const [c] = await tx`SELECT * FROM wind_candidates WHERE id = ${id} FOR UPDATE`; if (!c) throw new WindError("候选不存在");
    const status = input.decision === "accept" ? "accepted" : "rejected";
    if (c.status === status) {
      const [existing] = await tx`SELECT id, applied, kind FROM wind_changes WHERE candidate_id = ${id}`;
      return { status, change: existing ?? null, repeated: true };
    }
    if (c.status !== "pending") throw new WindError("该候选已经复核，请提交更正证据处理新变化", true);
    if (status === "rejected") {
      await tx`UPDATE wind_candidates SET status = 'rejected', reviewed_at = now(), reviewer = ${actor}, reason = ${reason} WHERE id = ${id}`;
      await trail(tx, actor, "wind.candidate.reject", `wind-candidate:${id}`, reason, { status: "pending" }, { status });
      return { status, change: null };
    }
    const projectId = input.projectId ?? c.project_id;
    if (typeof projectId !== "string") throw new WindError("请先明确候选所属项目");
    const [p] = await tx`SELECT * FROM wind_projects WHERE id = ${projectId} FOR UPDATE`; if (!p) throw new WindError("项目不存在");
    if (input.projectVersion !== p.version) throw new WindError("项目已被修改，请刷新并重新复核", true);
    const [e] = await tx`SELECT * FROM wind_evidence WHERE id = ${c.evidence_id}`;
    if (!e || !e.body.includes(c.quote)) throw new WindError("证据原句不在保存的正文中");
    if (c.planned && c.field !== "plannedGridDate") throw new WindError("计划不能更新实际里程碑");
    if (c.field !== "plannedGridDate" && c.event_date && day(c.event_date)! > new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date())) throw new WindError("未来日期只能保存为计划，不能确认已发生的变化");
    validateFact(c.field, c.value);
    const [before] = await tx`SELECT * FROM wind_facts WHERE project_id = ${projectId} AND field = ${c.field} AND scope = ${c.scope}`;
    const older = !!(before?.event_date && (!c.event_date || day(c.event_date)! < day(before.event_date)!));
    const same = before && JSON.stringify(before.value) === JSON.stringify(c.value);
    const applied = mode !== "historical" && (!older || mode === "correction") && !same;
    const supplement = !!e.published_at && Date.now() - new Date(e.published_at).getTime() > 48 * 3600_000;
    const kind = mode === "correction" ? "correction" : !applied ? "historical" : supplement ? "supplement" : "live";
    const changeId = randomUUID();
    await tx`INSERT INTO wind_changes (id, project_id, candidate_id, field, scope, before_value, after_value, event_date, applied, kind, reason, actor)
      VALUES (${changeId}, ${projectId}, ${id}, ${c.field}, ${c.scope}, ${before ? tx.json(before.value) : null}, ${tx.json(c.value)}, ${c.event_date}, ${applied}, ${kind}, ${reason}, ${actor})`;
    if (applied) await tx`INSERT INTO wind_facts (project_id, field, scope, value, event_date, change_id, evidence_id)
      VALUES (${projectId}, ${c.field}, ${c.scope}, ${tx.json(c.value)}, ${c.event_date}, ${changeId}, ${c.evidence_id})
      ON CONFLICT (project_id, field, scope) DO UPDATE SET value = EXCLUDED.value, event_date = EXCLUDED.event_date, change_id = EXCLUDED.change_id, evidence_id = EXCLUDED.evidence_id`;
    await tx`UPDATE wind_projects SET version = version + 1, updated_at = now() WHERE id = ${projectId}`;
    await tx`UPDATE wind_candidates SET project_id = ${projectId}, status = 'accepted', reviewed_at = now(), reviewer = ${actor}, reason = ${reason} WHERE id = ${id}`;
    await trail(tx, actor, "wind.candidate.accept", `wind-project:${projectId}`, reason, before ?? null, { candidateId: id, changeId, applied, kind, value: c.value, scope: c.scope });
    return { status, change: { id: changeId, applied, kind } };
  });
}

export async function setWindSources(projectId: string, input: { sourceIds?: unknown; version?: unknown }, actor: string) {
  if (!Array.isArray(input.sourceIds) || input.sourceIds.length > 100 || input.sourceIds.some(s => typeof s !== "string")) throw new WindError("信源 ID 列表无效");
  const ids = [...new Set(input.sourceIds as string[])].sort();
  return sql.begin(async tx => {
    const [p] = await tx`SELECT version FROM wind_projects WHERE id = ${projectId} FOR UPDATE`; if (!p) throw new WindError("项目不存在");
    if (p.version !== input.version) throw new WindError("项目已变化，请刷新", true);
    if (ids.length) {
      const sources = await tx`SELECT id FROM sources WHERE id = ANY(${ids})`;
      if (sources.length !== ids.length) throw new WindError("部分信源不存在，请先在信源管理中创建");
    }
    const before = await tx`SELECT source_id FROM wind_source_targets WHERE project_id = ${projectId}`;
    await tx`DELETE FROM wind_source_targets WHERE project_id = ${projectId}`;
    for (const id of ids) await tx`INSERT INTO wind_source_targets (project_id, source_id) VALUES (${projectId}, ${id})`;
    await tx`UPDATE wind_projects SET version = version + 1, updated_at = now() WHERE id = ${projectId}`;
    await trail(tx, actor, "wind.sources.set", `wind-project:${projectId}`, "配置项目监控信源", before, ids);
    return { sourceIds: ids };
  });
}
export async function windCoverage(): Promise<WindCoverage[]> {
  const rows = await sql`SELECT p.id AS project_id, p.name AS project_name, s.id AS source_id, s.name AS source_name,
    s.enabled AND p.enabled AS enabled, s.health, s.last_ok_at, s.last_fetch_at, s.next_fetch_at, s.last_error, s.interval_minutes,
    (SELECT status FROM fetch_runs f WHERE f.source_id = s.id ORDER BY started_at DESC LIMIT 1) AS latest_status
    FROM wind_source_targets t JOIN sources s ON s.id = t.source_id JOIN wind_projects p ON p.id = t.project_id ORDER BY p.name, s.name`;
  return rows.map(r => ({ projectId: r.project_id, projectName: r.project_name, sourceId: r.source_id, sourceName: r.source_name, enabled: r.enabled,
    health: r.health, lastOkAt: iso(r.last_ok_at), lastFetchAt: iso(r.last_fetch_at), nextFetchAt: iso(r.next_fetch_at), lastError: r.last_error,
    intervalMinutes: r.interval_minutes, status: !r.enabled ? "paused" : r.latest_status === "failed" || r.health === "failing" ? "failed" :
      !r.last_ok_at ? "unchecked" : Date.now() - new Date(r.last_ok_at).getTime() > Math.max(r.interval_minutes * 2, 60) * 60000 ? "overdue" : "ok" }));
}

/** Called by its own worker queue, independently of editorial selection and publication. */
export async function processWindArticle(articleId: string) {
  const [a] = await sql`SELECT a.id, a.url, a.title, a.body_text, a.body_status, a.published_at, a.content_hash, a.revision, s.name, s.tier
    FROM articles a JOIN sources s ON s.id = a.source_id WHERE a.id = ${articleId}
    AND EXISTS (SELECT 1 FROM wind_source_targets t JOIN wind_projects p ON p.id = t.project_id WHERE t.source_id = s.id AND p.enabled)`;
  if (!a) return { state: "not_monitored", created: 0 };
  const projects = await listWindProjects();
  const hash = inputDigest([a.title, a.body_text, a.body_status, a.tier, a.name, a.published_at, projects.map(meta), WIND_EXTRACTOR_VERSION]);
  return sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`wind-article:${articleId}`}))`;
    const [old] = await tx`SELECT input_hash FROM wind_article_runs WHERE article_id = ${articleId}`;
    if (old?.input_hash === hash) {
      await tx`UPDATE wind_article_runs SET article_revision = ${a.revision}, checked_at = now() WHERE article_id = ${articleId}`;
      return { state: "unchanged", created: 0 };
    }
    let created = 0; let status = "missing_body";
    if (a.body_status === "ok" && a.body_text) {
      const e = { url: safeEvidenceUrl(a.url), title: a.title as string, body: a.body_text as string, publisher: a.name as string, tier: a.tier === "T1" || a.tier === "T1_5" ? a.tier : "T2", publishedAt: a.published_at as Date | null };
      const evidenceId = await evidenceIn(tx, e, articleId);
      const extracted = extractWindRules(e.body, projects);
      for (const c of extracted) if (await candidateIn(tx, evidenceId, c, WIND_EXTRACTOR_VERSION)) created++;
      status = matchProjects(e.body, projects).length ? "ok" : "no_match";
    }
    await tx`INSERT INTO wind_article_runs (article_id, input_hash, status, candidates, article_revision) VALUES (${articleId}, ${hash}, ${status}, ${created}, ${a.revision})
      ON CONFLICT (article_id) DO UPDATE SET input_hash = EXCLUDED.input_hash, status = EXCLUDED.status, candidates = EXCLUDED.candidates, article_revision = EXCLUDED.article_revision, checked_at = now()`;
    return { state: status, created };
  });
}
export async function sweepWindArticles() {
  const rows = await sql`SELECT a.id FROM articles a WHERE EXISTS (
    SELECT 1 FROM wind_source_targets t JOIN wind_projects p ON p.id = t.project_id WHERE t.source_id = a.source_id AND p.enabled)
    AND (NOT EXISTS (SELECT 1 FROM wind_article_runs r WHERE r.article_id = a.id)
      OR a.revision <> (SELECT article_revision FROM wind_article_runs r WHERE r.article_id = a.id)
      OR a.updated_at > (SELECT checked_at FROM wind_article_runs r WHERE r.article_id = a.id)
      OR (SELECT max(updated_at) FROM wind_projects) > (SELECT checked_at FROM wind_article_runs r WHERE r.article_id = a.id))
    ORDER BY a.discovered_at DESC LIMIT 100`;
  let created = 0;
  for (const r of rows) created += (await processWindArticle(r.id as string)).created;
  return { checked: rows.length, created };
}
export async function windRunStatus() {
  const rows = await sql`SELECT r.*, a.title, a.url FROM wind_article_runs r JOIN articles a ON a.id = r.article_id ORDER BY r.checked_at DESC LIMIT 100`;
  return { rows };
}
export async function windBrief(date: string): Promise<WindBrief> {
  const d = dateOnly(date)!; if (!d) throw new WindError("简报日期不能为空");
  const through = new Date(`${d}T09:00:00+08:00`), from = new Date(through.getTime() - 86400000);
  const [allChanges, coverage, counts, unconfigured] = await Promise.all([
    changeRows(sql, null, from, through), windCoverage(), windOverview(),
    sql`SELECT count(*)::int AS n FROM wind_projects p WHERE p.enabled AND NOT EXISTS (SELECT 1 FROM wind_source_targets t WHERE t.project_id = p.id)`,
  ]);
  const changes = allChanges.filter(c => c.applied && c.kind !== "historical");
  const md = [`# 海上风电项目简报 · ${d}`, "", `统计窗口：北京时间前一日 09:00 至 ${d} 09:00。`, "", `已确认变化 ${changes.length} 项；当前待复核 ${counts.pending} 条。`, "",
    ...changes.flatMap(c => [`- ${c.projectName}：${WIND_FIELDS[c.field]} ${c.before ?? "未记录"} → ${c.after}${c.scope !== "project" ? `（${c.scope}）` : ""}${c.kind === "supplement" ? "【补发现】" : c.kind === "correction" ? "【更正】" : ""}。事件日期：${c.eventDate ?? "原文未明确"}。`, `  证据：[${c.title.replace(/[\[\]]/g, "")}](${c.url.replace(/[()]/g, c => encodeURIComponent(c))})`]),
    ...(changes.length ? [] : ["本统计窗口没有已确认的项目变化；这不代表全网没有变化。"]), "", "## 监控覆盖", "", "以下为当前信源检查状态，不作为历史刊期覆盖证明：",
    ...coverage.map(c => `- ${c.projectName} / ${c.sourceName}：${{ ok: "最近检查成功", failed: "检查失败", paused: "已暂停", unchecked: "尚未检查", overdue: "检查逾期" }[c.status]}。`),
    `- ${unconfigured[0].n} 个启用项目尚未配置监控信源。`, "", "待复核和覆盖为当前状态；本简报仅供内部使用。"].join("\n");
  return { day: d, from: from.toISOString(), through: through.toISOString(), changes, pending: counts.pending, coverage, unconfigured: unconfigured[0].n, markdown: md };
}
export async function exportWindProjects() {
  const projects = await listWindProjects();
  const facts = await sql`SELECT project_id, field, value FROM wind_facts WHERE scope = 'project'`;
  const current = new Map(facts.map(r => [`${r.project_id}:${r.field}`, r.value]));
  const header = ["id", "name", "province", "city", "developer", "capacityMw", "aliases", "priority"];
  return "\uFEFF" + [header.join(","), ...projects.map(p => [p.id, p.name, p.province, p.city, current.get(`${p.id}:developer`) ?? p.developer,
    current.get(`${p.id}:capacityMw`) ?? p.capacityMw, p.aliases.join(";"), p.priority].map(csvCell).join(","))].join("\r\n");
}
