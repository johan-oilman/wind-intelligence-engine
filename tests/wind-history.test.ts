import { tag } from "./setup.ts";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { closeDb, sql } from "@aihot/backend/db";
import { sha256 } from "@aihot/backend/lib/ids";
import { importWindHistory, linkWindHistory, parseHistoryEvents, relinkWindHistory, windHistory } from "@aihot/backend/projects/history";
import { commitWindImport, previewWindImport, windProjectDetail } from "@aihot/backend/projects/service";
import { buildApp } from "../apps/api/src/app.ts";

const T = tag(), actor = `test:${T}`;
after(closeDb);
const raw = (suffix: string) => ({ origin: "gmail", externalId: `${T}-${suffix}`, title: "历史监控通知", body: JSON.stringify({ project_hint: `测试历史${T}海风项目`, event_type: "中标", event_date: "2026-07-23", summary: "发布中标候选人公示，仍需关注正式中标结果。", source_url: "https://example.com/announcement" }), sentRecord: true, sourceAt: "2026-07-25T01:00:53Z" });
test("history keeps candidates, summary provenance and invalid fields without promoting milestones", () => {
  const body = raw("parse").body;
  const result = parseHistoryEvents(`${body}\n<p>${body}</p>`);
  assert.equal(result.events.length, 1); assert.match(result.events[0].summary, /中标候选人/);
  assert.match(result.note, /尚需核对/);
  const invalid = parseHistoryEvents(JSON.stringify({ project_hint: "测试项目", summary: "原始记录", event_date: "2026-02-30", source_url: "javascript:alert(1)" }));
  assert.equal(invalid.events[0].eventDate, null); assert.equal(invalid.events[0].sourceUrl, null); assert.match(invalid.note, /无效/);
});
test("history import is idempotent and immutable; conflicting batches roll back and do not enqueue notifications", async () => {
  const [deliveriesBefore] = await sql`SELECT count(*)::int AS n FROM deliveries`;
  const input = { ...raw("immutable"), archiveUrl: "https://mail.google.com/mail/u/0/#all/record-id" };
  assert.deepEqual(await importWindHistory({ records: [input] }, actor), { created: 1, repeated: 0 });
  assert.deepEqual(await importWindHistory({ records: [input] }, actor), { created: 0, repeated: 1 });
  await assert.rejects(importWindHistory({ records: [raw("rollback"), { ...input, body: "changed report" }] }, actor), /不会覆盖/);
  const records = await windHistory(`测试历史${T}`); const saved = records.find(r => r.externalId === input.externalId)!;
  assert.equal(saved.body, input.body); assert.equal(saved.notification, "sent_record"); assert.equal(saved.events[0].eventDate, "2026-07-23");
  assert.equal(saved.archiveUrl, input.archiveUrl, "archive fragments locate the exact original message");
  assert.equal(records.some(r => r.externalId === raw("rollback").externalId), false);
  const [fact] = await sql`SELECT count(*)::int AS n FROM wind_facts WHERE project_id LIKE ${`HISTORY-${T}%`}`; assert.equal(fact.n, 0);
  const [audit] = await sql`SELECT count(*)::int AS n FROM audit_log WHERE actor = ${actor} AND action = 'wind.history.import'`; assert.equal(audit.n, 2);
  const [deliveriesAfter] = await sql`SELECT count(*)::int AS n FROM deliveries`; assert.equal(deliveriesAfter.n, deliveriesBefore.n);
});
test("historical associations can be recovered after importing a baseline and manual empty choices survive relinks", async () => {
  const name = `测试历史${T}海风项目`, id = `HISTORY-${T}`;
  const input = raw("late-registry"); await importWindHistory({ records: [input] }, actor);
  let record = (await windHistory(name)).find(r => r.externalId === input.externalId)!; assert.equal(record.projects.length, 0);
  const projects = [{ id, name, enabled: false }]; const preview = await previewWindImport({ projects }); await commitWindImport({ projects, token: preview.token }, actor);
  await relinkWindHistory(actor); record = (await windHistory("", id)).find(r => r.id === record.id)!;
  assert.equal(record.projects[0].method, "name_match", "paused projects still retain their historical associations");
  await linkWindHistory(record.id, { projectIds: [] }, actor); await relinkWindHistory(actor);
  assert.equal((await windHistory("", null, record.id))[0].projects.length, 0);
  await linkWindHistory(record.id, { projectIds: [id] }, actor); await relinkWindHistory(actor);
  assert.equal((await windHistory("", id)).find(r => r.id === record.id)!.projects[0].method, "manual");
  assert.equal((await windProjectDetail(id))!.facts.length, 0);
});
test("a report claiming email delivery is unknown; explicit unavailability and a provider sent record differ", async () => {
  const records = [
    { origin: "conversation", externalId: `${T}-claim`, title: "旧报告", body: "邮件已发送，置信度100。", sentRecord: true },
    { origin: "conversation", externalId: `${T}-unavailable`, title: "旧报告", body: "当前邮件投递未启用，因此未实际发送邮件。" },
  ];
  await importWindHistory({ records }, actor);
  const all = await windHistory();
  assert.equal(all.find(r => r.externalId === `${T}-claim`)!.notification, "unknown");
  assert.equal(all.find(r => r.externalId === `${T}-unavailable`)!.notification, "not_sent");
});
test("historical mailbox endpoints are private and imports use the same CSRF boundary", async () => {
  const app = await buildApp();
  try {
    for (const path of ["/api/admin/wind/history", "/api/admin/wind/history/unknown"])
      assert.equal((await app.inject({ url: path })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: "/api/admin/wind/history/import", payload: { records: [raw("api")] } })).statusCode, 401);
    const [user] = await sql`INSERT INTO admin_users (display_name) VALUES ('History test') RETURNING id`;
    const token = `history-session-${T}`;
    await sql`INSERT INTO admin_sessions (id_hash, user_id, csrf_token, expires_at) VALUES (${sha256(token)}, ${user.id}, 'history-csrf', now() + interval '1 hour')`;
    const headers = { cookie: `aihot_admin=${token}` };
    assert.equal((await app.inject({ url: "/api/admin/wind/history", headers })).statusCode, 200);
    for (const url of ["/api/admin/wind/history/import", "/api/admin/wind/history/relink", "/api/admin/wind/history/unknown/projects"])
      assert.equal((await app.inject({ method: "POST", url, headers, payload: {} })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url: "/api/admin/wind/history/import", headers: { ...headers, 'x-csrf-token': 'history-csrf' }, payload: { records: [raw("api")] } })).statusCode, 200);
  } finally { await app.close(); }
});
