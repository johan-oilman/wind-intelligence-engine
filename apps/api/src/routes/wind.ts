import type { FastifyInstance, FastifyRequest } from "fastify";
import { actorOf } from "@aihot/backend/admin/auth";
import { commitWindImport, exportWindProjects, getWindEvidence, listWindProjects, previewWindImport, processWindArticle, reviewWindCandidate, setWindSources, submitWindEvidence, sweepWindArticles, windBrief, windCandidates, windCoverage, windOverview, windProjectDetail, windRunStatus } from "@aihot/backend/projects/service";
import { adminHandler } from "./admin-auth.ts";
import { sendProblem } from "../http/respond.ts";
import { importWindHistory, linkWindHistory, relinkWindHistory, windHistory, windHistoryStats } from "@aihot/backend/projects/history";
import { linkProgress, progressInbox, windProgress } from "@aihot/backend/projects/progress";

const q = (req: FastifyRequest) => req.query as Record<string, string | undefined>;
const param = (req: FastifyRequest, name: string) => (req.params as Record<string, string>)[name];
const body = (req: FastifyRequest) => (req.body ?? {}) as Record<string, unknown>;

/** Private project endpoints reuse the existing session and CSRF boundary. */
export function registerWind(app: FastifyInstance) {
  app.get("/api/admin/wind/history", adminHandler(async req => ({ rows: await windHistory(q(req).q, q(req).projectId ?? null), stats: await windHistoryStats() })));
  app.get("/api/admin/wind/history/:id", adminHandler(async (req, reply) => (await windHistory("", null, param(req, "id")))[0] ?? sendProblem(req, reply, { status: 404, code: "not_found", detail: "历史记录不存在" })));
  app.post("/api/admin/wind/history/import", adminHandler(async (req, _reply, admin) => importWindHistory(body(req), actorOf(admin))));
  app.post("/api/admin/wind/history/relink", adminHandler(async (_req, _reply, admin) => relinkWindHistory(actorOf(admin))));
  app.post("/api/admin/wind/history/:id/projects", adminHandler(async (req, _reply, admin) => linkWindHistory(param(req, "id"), body(req), actorOf(admin))));
  app.get("/api/admin/wind/progress/inbox", adminHandler(async () => ({ rows: await progressInbox() })));
  app.post("/api/admin/wind/history/:id/events/:index/projects", adminHandler(async (req, _reply, admin) => linkProgress(param(req, "id"), Number(param(req, "index")), body(req), actorOf(admin))));
  app.get("/api/admin/wind/projects", adminHandler(async req => {
    const rows = (await listWindProjects(q(req).q)).filter(p => !p.id.startsWith("DEMO-"));
    const progress = await windProgress(rows.map(p => p.id));
    const byProject = new Map(rows.map(p => [p.id, [] as typeof progress]));
    for (const entry of progress) byProject.get(entry.projectId)?.push(entry);
    return { rows: rows.map(p => { const entries = byProject.get(p.id)!; return { ...p, progressCount: entries.length, latestProgress: entries[0] ?? null }; }) };
  }));
  app.get("/api/admin/wind/overview", adminHandler(async () => windOverview()));
  app.post("/api/admin/wind/import/preview", adminHandler(async req => previewWindImport(body(req))));
  app.post("/api/admin/wind/import/commit", adminHandler(async (req, _reply, admin) => commitWindImport(body(req), actorOf(admin))));
  app.get("/api/admin/wind/export", adminHandler(async (_req, reply) => reply.type("text/csv; charset=utf-8").header("Content-Disposition", 'attachment; filename="wind-projects.csv"').send(await exportWindProjects())));
  app.get("/api/admin/wind/projects/:id", adminHandler(async (req, reply) => {
    const id = param(req, "id");
    const [result, progress] = await Promise.all([windProjectDetail(id), windProgress([id])]);
    return result ? { ...result, progress } : sendProblem(req, reply, { status: 404, code: "not_found", detail: "项目不存在" });
  }));
  app.post("/api/admin/wind/projects/:id/sources", adminHandler(async (req, _reply, admin) => setWindSources(param(req, "id"), body(req), actorOf(admin))));
  app.get("/api/admin/wind/candidates", adminHandler(async req => ({ rows: await windCandidates(q(req).status, q(req).projectId ?? null) })));
  app.post("/api/admin/wind/candidates/:id/review", adminHandler(async (req, _reply, admin) => reviewWindCandidate(param(req, "id"), body(req), actorOf(admin))));
  app.post("/api/admin/wind/evidence", adminHandler(async (req, _reply, admin) => submitWindEvidence(body(req), actorOf(admin))));
  app.get("/api/admin/wind/evidence/:id", adminHandler(async (req, reply) => {
    const result = await getWindEvidence(param(req, "id"));
    return result ?? sendProblem(req, reply, { status: 404, code: "not_found", detail: "证据不存在" });
  }));
  app.get("/api/admin/wind/coverage", adminHandler(async () => ({ rows: await windCoverage() })));
  app.get("/api/admin/wind/runs", adminHandler(async () => windRunStatus()));
  app.post("/api/admin/wind/scan", adminHandler(async () => sweepWindArticles()));
  app.post("/api/admin/wind/articles/:id/scan", adminHandler(async req => processWindArticle(param(req, "id"))));
  app.get("/api/admin/wind/brief", adminHandler(async req => windBrief(q(req).day ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date()))));
}
