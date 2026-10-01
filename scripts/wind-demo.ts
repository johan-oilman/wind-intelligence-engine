// Explicit opt-in demo: fictional projects and evidence, never a production seed.
import { closeDb } from "@aihot/backend/db";
import { commitWindImport, previewWindImport, submitWindEvidence } from "@aihot/backend/projects/service";

if (!process.argv.includes("--confirm-demo") || process.env.NODE_ENV === "production") {
  throw new Error("Demo writes fictional data. Use --confirm-demo in a local development database.");
}
const projects = [
  { id: "DEMO-GD-001", name: "示例粤东一期海上风电项目", province: "广东", city: "示例市", developer: "示例能源", capacityMw: 500, aliases: ["示例粤东一期项目"], priority: "high" },
  { id: "DEMO-GD-002", name: "示例粤东二期海上风电项目", province: "广东", city: "示例市", developer: "示例能源", capacityMw: 600, aliases: ["示例粤东二期项目"], priority: "normal" },
];
const preview = await previewWindImport({ projects });
await commitWindImport({ projects, token: preview.token }, "demo:seed");
const result = await submitWindEvidence({ url: "https://example.invalid/wind-demo/epc", title: "示例一期项目 EPC 招标公告（虚构演示）", publisher: "示例交易平台（虚构）", tier: "T1",
  publishedAt: "2026-09-30", body: "示例粤东一期海上风电项目于2026年9月30日发布EPC招标公告。该项目装机容量为50万千瓦。\n本材料为虚构演示数据，不代表真实项目动态。" }, "demo:seed");
console.log(`demo projects ready; ${result.created} pending candidate(s)`);
await closeDb();
