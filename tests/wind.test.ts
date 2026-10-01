import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { sha256 } from "@aihot/backend/lib/ids";
import { capacityMw, csvCell, dateOnly, extractWindRules, parseProjectImport, projectInput } from "@aihot/backend/projects/rules";
import { commitWindImport, getWindEvidence, previewWindImport, processWindArticle, reviewWindCandidate, setWindSources, submitWindEvidence, windCandidates, windCoverage, windProjectDetail } from "@aihot/backend/projects/service";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { stopBoss, QUEUES } from "@aihot/backend/jobs/queue";
import { queueProcessing } from "@aihot/backend/jobs/content";
import { buildApp } from "../apps/api/src/app.ts";

const T = tag(), actor = `test:${T}`;
const input = (suffix: string) => ({ id: `WIND-${T}-${suffix}`, name: `测试海风${T}${suffix}项目`, province: "广东", city: "测试市", developer: "测试能源", capacityMw: "50万千瓦", aliases: [`测试别名${T}${suffix}`], priority: "high" });
async function addProject(suffix: string) {
  const raw = input(suffix); const preview = await previewWindImport({ projects: [raw] });
  assert.deepEqual(preview.errors, []); await commitWindImport({ projects: [raw], token: preview.token }, actor);
  return raw;
}
async function manual(p: { id: string; name: string }, value: string, eventDate: string | null, scope = "project", field = "grid", suffix = value) {
  const body = `${p.name}：${value}（${suffix}）。`;
  const r = await submitWindEvidence({ url: `https://example.com/${T}/${p.id}/${encodeURIComponent(suffix)}`, title: `公告${suffix}`, publisher: "测试交易平台", body, tier: "T1", publishedAt: "2026-01-01",
    candidate: { projectId: p.id, value, field, quote: body, eventDate, scope } }, actor);
  const rows = (await windCandidates("all", p.id)).filter(c => c.evidenceId === r.evidenceId);
  assert.equal(rows.length, 1); return rows[0];
}
async function accept(id: string, p: { id: string }, mode = "current") {
  const detail = (await windProjectDetail(p.id))!;
  return reviewWindCandidate(id, { decision: "accept", projectId: p.id, projectVersion: detail.project.version, reason: "测试：已核对项目、原句与事件日期", mode }, actor);
}
after(async () => { await stopBoss(); await closeDb(); });

test("wind import validates units, dates and quoted CSV rather than silently shifting columns", () => {
  assert.equal(capacityMw("100万千瓦"), 1000); assert.equal(capacityMw("500000 kW"), 500); assert.equal(capacityMw("0.6GW"), 600);
  assert.throws(() => capacityMw("容量500")); assert.throws(() => capacityMw(-1)); assert.throws(() => dateOnly("2026-02-30"));
  const parsed = parseProjectImport({ csv: 'id,name,capacityMw,aliases\nwind-001,"示例,海风项目",50万千瓦,"别名海风;另一个别名"' });
  assert.deepEqual(parsed.errors, []); assert.equal(parsed.rows[0].name, "示例,海风项目"); assert.equal(parsed.rows[0].capacityMw, 500);
  assert.ok(parseProjectImport({ csv: 'id,name\nx,"未闭合' }).errors.length);
  assert.ok(parseProjectImport({ projects: [input("duplicate"), input("duplicate")] }).errors.length);
  assert.match(csvCell("=IMPORTXML(1)"), /^"'=/);
});
test("wind starter rules separate phases, ambiguity, planned and actual claims", () => {
  const p1 = projectInput({ ...input("phase1"), name: `测试海风${T}一期项目` }), p2 = projectInput({ ...input("phase2"), name: `测试海风${T}二期项目` });
  const ambiguous = extractWindRules(`${p1.name}和${p2.name}发布招标公告。`, [p1, p2]);
  assert.equal(ambiguous[0].projectId, null); assert.equal(ambiguous[0].matches.length, 2);
  assert.equal(extractWindRules(`${p1.name}预计2027年2月1日全容量并网。`, [p1])[0].field, "plannedGridDate");
  assert.equal(extractWindRules(`${p1.name}尚未全容量并网。`, [p1]).length, 0);
  const actual = extractWindRules(`${p1.name}于2026年9月30日首台机组并网。`, [p1]);
  assert.equal(actual[0].value, "首次并网"); assert.equal(actual[0].eventDate, "2026-09-30");
  assert.equal(actual[0].scope, "project", "phase in the project's registered name is not a separate sub-scope");
  assert.equal(extractWindRules(`${p1.name}海缆标段中标结果公示。`, [p1])[0].scope, "海缆标段");
  const capacity = extractWindRules(`${p1.name}装机容量由50万千瓦调整为60万千瓦。`, [p1]);
  assert.deepEqual(capacity.filter(c => c.field === "capacityMw").map(c => c.value), [600]);
});
test("wind import preview is read-only, idempotent and rejects stale changes atomically", async () => {
  const raw = input("import"), preview = await previewWindImport({ projects: [raw] });
  assert.equal(await windProjectDetail(raw.id), null);
  assert.deepEqual(await commitWindImport({ projects: [raw], token: preview.token }, actor), { created: 1, updated: 0, unchanged: 0 });
  assert.equal((await windProjectDetail(raw.id))!.project.capacityMw, 500);
  await assert.rejects(commitWindImport({ projects: [raw], token: preview.token }, actor), /重新预览/);
  const next = await previewWindImport({ projects: [raw] });
  assert.deepEqual(await commitWindImport({ projects: [raw], token: next.token }, actor), { created: 0, updated: 0, unchanged: 1 });
  const empty = { ...raw, developer: "", capacityMw: "" }, preserving = await previewWindImport({ projects: [empty] });
  assert.equal(preserving.rows[0].developer, raw.developer); assert.equal(preserving.rows[0].capacityMw, 500);
});
test("saved evidence is immutable per content version and duplicate candidates stay reviewed", async () => {
  const p = await addProject("evidence"); const c = await manual(p, "首次并网", "2026-09-01");
  assert.equal((await getWindEvidence(c.evidenceId))!.body, c.quote);
  await accept(c.id, p);
  const again = await manual(p, "首次并网", "2026-09-01"); assert.equal(again.id, c.id); assert.equal(again.status, "accepted");
  const repeated = await accept(c.id, p); assert.equal(repeated.repeated, true);
  assert.equal((await windProjectDetail(p.id))!.changes.length, 1);
  const version2 = await submitWindEvidence({ url: c.url, title: "更正公告", publisher: "测试交易平台", body: `${p.name}全容量并网。`, tier: "T1" }, actor);
  assert.notEqual(version2.evidenceId, c.evidenceId); assert.equal((await getWindEvidence(c.evidenceId))!.body, c.quote);
});
test("older and date-unknown evidence supplements history without regressing current facts", async () => {
  const p = await addProject("dates"); await accept((await manual(p, "全容量并网", "2026-09-20")).id, p);
  const older = await accept((await manual(p, "首次并网", "2026-09-01")).id, p);
  assert.equal(older.change?.applied, false); assert.equal(older.change?.kind, "historical");
  await accept((await manual(p, "首次并网", null, "project", "grid", "unknown-date")).id, p);
  const detail = (await windProjectDetail(p.id))!; assert.equal(detail.facts[0].value, "全容量并网"); assert.equal(detail.changes.length, 3);
});
test("lot and phase facts do not update the whole project's grid or procurement", async () => {
  const p = await addProject("scope"); await accept((await manual(p, "中标", "2026-09-01", "海缆标段", "procurement")).id, p);
  await accept((await manual(p, "首次并网", "2026-09-02", "二期", "grid")).id, p);
  const detail = (await windProjectDetail(p.id))!;
  assert.equal(detail.facts.filter(f => f.scope === "project").length, 0);
  assert.equal(detail.facts.find(f => f.scope === "海缆标段")?.value, "中标");
});
test("explicit correction is audited and imported baselines cannot overwrite confirmed facts", async () => {
  const p = await addProject("correction"); await accept((await manual(p, "全容量并网", "2026-09-20")).id, p);
  const correction = await accept((await manual(p, "首次并网", "2026-09-01", "project", "grid", "official-correction")).id, p, "correction");
  assert.equal(correction.change?.kind, "correction"); assert.equal((await windProjectDetail(p.id))!.facts[0].value, "首次并网");
  const preview = await previewWindImport({ projects: [{ ...p, capacityMw: 700 }] });
  await commitWindImport({ projects: [{ ...p, capacityMw: 700 }], token: preview.token }, actor);
  assert.equal((await windProjectDetail(p.id))!.facts[0].value, "首次并网");
  const audit = await sql`SELECT action FROM audit_log WHERE subject = ${`wind-project:${p.id}`} AND action = 'wind.candidate.accept'`;
  assert.equal(audit.length, 2);
});
test("concurrent reviewers cannot both overwrite a project from the same version", async () => {
  const p = await addProject("concurrent"), a = await manual(p, "首次并网", "2026-09-01"), b = await manual(p, "全容量并网", "2026-09-20");
  const version = (await windProjectDetail(p.id))!.project.version;
  const results = await Promise.allSettled([a, b].map(c => reviewWindCandidate(c.id, { decision: "accept", projectId: p.id, projectVersion: version, reason: "并发确认" }, actor)));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal(results.filter(r => r.status === "rejected").length, 1);
});
test("invalid quotation, planned milestones and stale versions do not write facts", async () => {
  const p = await addProject("invalid");
  await assert.rejects(submitWindEvidence({ url: "https://example.com/wind", title: "测试", publisher: "测试", body: "未提到该项目", candidate: { projectId: p.id, field: "grid", value: "全容量并网", quote: "编造的原句" } }, actor), /必须出现在/);
  await assert.rejects(submitWindEvidence({ url: "https://example.com/wind", title: "测试", publisher: "测试", body: "计划并网", candidate: { projectId: p.id, field: "grid", value: "全容量并网", quote: "计划并网", planned: true } }, actor), /计划.*表述/);
  const c = await manual(p, "首次并网", null);
  await assert.rejects(reviewWindCandidate(c.id, { decision: "accept", projectVersion: 0, reason: "错误版本" }, actor), /已被修改/);
  assert.equal((await windProjectDetail(p.id))!.facts.length, 0);
});
test("isolated historical material is monitored independently of news selection and has a queue", async () => {
  const p = await addProject("isolated"), sourceId = `wind-source-${T}`;
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, enabled) VALUES (${sourceId}, '测试一手来源', 'external', 'T1', 'isolated', false)`;
  await setWindSources(p.id, { sourceIds: [sourceId], version: (await windProjectDetail(p.id))!.project.version }, actor);
  const material = await upsertMaterial({ sourceId, url: `https://example.com/${T}/single-source`, title: `${p.name}招标`, bodyText: `${p.name}于2026年1月1日发布EPC招标公告。`, bodyStatus: "ok", publishedAt: new Date("2026-01-01"), via: "ingest", backfill: "reported-backfill" });
  const result = await processWindArticle(material.articleId); assert.equal(result.created, 1);
  assert.equal((await processWindArticle(material.articleId)).state, "unchanged");
  const c = (await windCandidates("pending", p.id))[0]; assert.equal(c.value, "招标");
  assert.equal((await accept(c.id, p)).change?.kind, "supplement");
  const publications = await sql`SELECT 1 FROM publications WHERE article_id = ${material.articleId}`; assert.equal(publications.length, 0);
  await queueProcessing(material.articleId);
  const jobs = await sql`SELECT 1 FROM pgboss.job WHERE name = ${QUEUES.windMonitor} AND data->>'articleId' = ${material.articleId}`;
  assert.equal(jobs.length, 1);
  assert.equal((await windCoverage()).find(c => c.projectId === p.id)?.status, "paused");
});
test("private wind APIs require a session and CSRF, and return useful validation errors", async () => {
  const app = await buildApp();
  try {
    for (const path of ["projects", "overview", "candidates", "coverage", "brief", "export", "evidence/unknown"]) {
      const r = await app.inject({ url: `/api/admin/wind/${path}` }); assert.equal(r.statusCode, 401, path); assert.equal(r.headers["cache-control"], "no-store");
    }
    const [user] = await sql`INSERT INTO admin_users (display_name) VALUES ('Wind test') RETURNING id`;
    const token = `wind-session-${T}`;
    await sql`INSERT INTO admin_sessions (id_hash, user_id, csrf_token, expires_at) VALUES (${sha256(token)}, ${user.id}, 'wind-csrf', now() + interval '1 hour')`;
    const headers = { cookie: `aihot_admin=${token}` };
    assert.equal((await app.inject({ method: "POST", url: "/api/admin/wind/import/preview", headers, payload: { projects: [input("api")] } })).statusCode, 403);
    const authorized = { ...headers, "x-csrf-token": "wind-csrf" };
    assert.equal((await app.inject({ url: "/api/admin/wind/projects", headers })).statusCode, 200);
    const bad = await app.inject({ method: "POST", url: "/api/admin/wind/evidence", headers: authorized, payload: { url: "javascript:alert(1)" } });
    assert.equal(bad.statusCode, 400);
    assert.equal((await app.inject({ url: "/api/admin/wind/brief?day=2026-02-30", headers })).statusCode, 400);
  } finally { await app.close(); }
});
