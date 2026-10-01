import { tag } from './setup.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql, closeDb } from '@aihot/backend/db';
import { commitWindImport, exportWindProjects, previewWindImport, windOverview, windProjectDetail } from '@aihot/backend/projects/service';
import { importWindHistory, linkWindHistory, relinkWindHistory, windHistory } from '@aihot/backend/projects/history';
import { linkProgress, progressInbox, windProgress } from '@aihot/backend/projects/progress';
import { buildApp } from '../apps/api/src/app.ts';
import { sha256 } from '@aihot/backend/lib/ids';
const T = tag(), actor = `test:${T}`;
after(closeDb);
async function project(s: string) {
  const p = { id: `PROGRESS-${T}-${s}`, name: `测试${T}${s}海上风电项目` };
  const preview = await previewWindImport({ projects: [p] }); await commitWindImport({ projects: [p], token: preview.token }, actor); return p;
}
function event(name: string, summary: string, date: string | null = '2026-07-01', type = '招标', url = 'notice') {
  return { project_hint: name, event_type: type, event_date: date, summary, source_url: `https://example.com/${T}/${url}` };
}
async function record(s: string, events: unknown[], date = '2026-10-01T08:00:00Z') {
  const input = { origin: 'gmail', externalId: `${T}-${s}`, title: '历史项目进展通知', body: JSON.stringify(events), sentRecord: true, sourceAt: date };
  await importWindHistory({ records: [input] }, actor);
  return (await windHistory()).find(r => r.externalId === input.externalId)!;
}
test('a multi-project report is split by event; duplicate notices merge and event dates order progress', async () => {
  const a = await project('split-a'), b = await project('split-b');
  const events = [event(a.name, '设备公开招标公告。'), event(b.name, '另一项目正式开工。', '2026-07-03', '开工', 'b')];
  const r = await record('multi', events);
  await linkWindHistory(r.id, { projectIds: [a.id, b.id] }, actor);
  await record('resent', events, '2026-06-01T08:00:00Z');
  await record('later', [event(a.name, '公布正式中标结果。', '2026-07-15', '中标', 'result')]);
  const pa = await windProgress([a.id]);
  assert.equal(pa.length, 2); assert.equal(pa[0].eventDate, '2026-07-15'); assert.equal(pa[1].records.length, 2);
  assert.equal(pa.some(e => e.summary.includes('另一项目')), false);
  assert.equal((await windProgress([b.id])).length, 1);
  assert.equal((await windProjectDetail(a.id))!.facts.length, 0);
  const ambiguous = await record('joint', [event(`${a.name}、${b.name}`, '联合送出工程招标。', '2026-08-01', '招标', 'joint')]);
  assert.equal((await progressInbox()).some(e => e.historyId === ambiguous.id), true);
  assert.equal((await windProgress([a.id])).length, 2, 'ambiguous ownership needs event-level review');
  await linkProgress(ambiguous.id, 0, { projectIds: [a.id, b.id] }, actor);
  assert.equal((await windProgress([a.id])).length, 3);
});
test('a candidate announcement and final result stay separate even when the old email labels both 中标', async () => {
  const p = await project('candidate');
  await record('candidate', [event(p.name, '发布中标候选人公示。', '2026-07-01', '中标', 'combined'), event(p.name, '已公布正式中标结果。', '2026-07-01', '中标', 'combined')]);
  assert.deepEqual(new Set((await windProgress([p.id])).map(e => e.eventType)), new Set(['中标候选人公示', '中标']));
});
test('manual event ownership overrides matching; clearing it survives a new baseline and never changes facts', async () => {
  const a = await project('manual-a'), b = await project('manual-b');
  const r = await record('manual', [event(a.name, '设备招标。')]);
  await linkProgress(r.id, 0, { projectIds: [b.id] }, actor); await relinkWindHistory(actor);
  assert.equal((await windProgress([a.id])).length, 0); assert.equal((await windProgress([b.id])).length, 1);
  await linkProgress(r.id, 0, { projectIds: [] }, actor); await project('manual-c'); await relinkWindHistory(actor);
  assert.equal((await windProgress([b.id])).length, 0);
  assert.equal((await progressInbox()).some(e => e.historyId === r.id), false);
  assert.equal((await windProjectDetail(b.id))!.facts.length, 0);
  assert.equal((await windHistory('', null, r.id))[0].body, r.body);
});
test('baseline import recovers previously unassigned progress without inventing new projects from mail', async () => {
  const name = `测试${T}late海上风电项目`;
  const r = await record('late', [event(name, '首次并网。', '2026-07-06', '并网'), event(name, '恢复重点监控规则。', null, '历史监控范围恢复')]);
  assert.equal((await progressInbox()).filter(e => e.historyId === r.id).length, 1);
  const [before] = await sql`SELECT count(*)::int AS n FROM wind_projects WHERE name = ${name}`; assert.equal(before.n, 0);
  const p = await project('late');
  assert.equal((await windProgress([p.id])).length, 1);
  assert.equal((await progressInbox()).some(e => e.historyId === r.id), false);
  await assert.rejects(linkProgress(r.id, 1, { projectIds: [p.id] }, actor), /不属于工程进展/);
});
test('project progress inbox and event assignment remain behind session and CSRF handlers', async () => {
  const before = await windOverview();
  const demo = { id: `DEMO-${T}`, name: `示例${T}海上风电项目` };
  const preview = await previewWindImport({ projects: [demo] }); await commitWindImport({ projects: [demo], token: preview.token }, actor);
  assert.equal((await windOverview()).projects, before.projects);
  assert.equal((await exportWindProjects()).includes(demo.id), false);
  const app = await buildApp();
  try {
    assert.equal((await app.inject({ url: '/api/admin/wind/progress/inbox' })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/api/admin/wind/history/unknown/events/0/projects', payload: { projectIds: [] } })).statusCode, 401);
    await assert.rejects(linkProgress('unknown', -1, { projectIds: [] }, actor), /格式/);
    const [user] = await sql`INSERT INTO admin_users (display_name) VALUES ('Progress test') RETURNING id`;
    const token = `progress-session-${T}`;
    await sql`INSERT INTO admin_sessions (id_hash, user_id, csrf_token, expires_at) VALUES (${sha256(token)}, ${user.id}, 'progress-csrf', now() + interval '1 hour')`;
    const headers = { cookie: `aihot_admin=${token}` };
    const list = await app.inject({ url: '/api/admin/wind/projects', headers });
    assert.equal(list.statusCode, 200);
    assert.ok(list.json().rows.every((p: { id: string; progressCount: number }) => !p.id.startsWith('DEMO-') && typeof p.progressCount === 'number'));
    assert.equal((await app.inject({ method: 'POST', url: '/api/admin/wind/history/unknown/events/0/projects', headers, payload: { projectIds: [] } })).statusCode, 403);
  } finally { await app.close(); }
});
