import { WIND_FIELDS, WIND_VALUES, type WindField, type WindProjectInput } from "@aihot/contracts/wind";
import { sha256 } from "../lib/ids.ts";

export const WIND_EXTRACTOR_VERSION = "wind-rules-v1";
export class WindError extends Error {
  statusCode = 400;
  code: string;
  constructor(message: string, conflict = false) { super(message); this.code = conflict ? "conflict" : "invalid_request"; this.statusCode = conflict ? 409 : 400; }
}
export function dateOnly(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new WindError("日期必须为 YYYY-MM-DD");
  const d = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw new WindError("日期无效");
  return value;
}
export function capacityMw(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  let n: number;
  if (typeof value === "number") n = value;
  else if (typeof value === "string") {
    const m = /^\s*(\d+(?:\.\d+)?)\s*(MW|兆瓦|万千瓦|千瓦|kW|GW|吉瓦)?\s*$/i.exec(value);
    if (!m) throw new WindError("容量需为数字，可带 MW、万千瓦、千瓦或 GW 单位");
    const factor = /万千瓦/.test(m[2] ?? "") ? 10 : /^(千瓦|kw)$/i.test(m[2] ?? "") ? 0.001 : /^(gw|吉瓦)$/i.test(m[2] ?? "") ? 1000 : 1;
    n = Number(m[1]) * factor;
  } else throw new WindError("容量格式无效");
  if (!Number.isFinite(n) || n <= 0 || n > 100000) throw new WindError("容量必须大于 0 且不超过 100000 MW");
  return Math.round(n * 1000000) / 1000000;
}
export function validateFact(field: unknown, value: unknown): { field: WindField; value: string | number } {
  if (typeof field !== "string" || !Object.hasOwn(WIND_FIELDS, field)) throw new WindError("不支持的事实字段");
  const f = field as WindField;
  if (f === "capacityMw") {
    const v = capacityMw(value); if (v === null) throw new WindError("容量不能为空");
    return { field: f, value: v };
  }
  if (typeof value !== "string" || !value.trim() || value.length > 200) throw new WindError("事实值不能为空且需少于 200 字");
  const v = value.trim();
  if (f === "plannedGridDate") dateOnly(v);
  if (WIND_VALUES[f] && !WIND_VALUES[f]!.includes(v)) throw new WindError("事实值不在该字段允许的范围内");
  return { field: f, value: v };
}
export function scopeOf(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 120) throw new WindError("请明确项目、分期或标段范围");
  return value.trim();
}
export function safeEvidenceUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2000) throw new WindError("原文网址无效");
  try {
    const u = new URL(value);
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw new Error();
    u.hash = "";
    return u.href;
  } catch { throw new WindError("原文网址必须是 HTTP 或 HTTPS，且不能包含登录凭据"); }
}
export function projectInput(value: unknown): WindProjectInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WindError("项目行需为对象");
  const r = value as Record<string, unknown>;
  if (typeof r.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$/.test(r.id)) throw new WindError("项目 ID 需为 3–80 位字母、数字、下划线或连字符");
  if (typeof r.name !== "string" || r.name.trim().length < 4 || r.name.length > 200) throw new WindError("项目名称需为 4–200 字");
  const text = (key: string, max = 120): string => {
    const v = r[key];
    if (v === null || v === undefined || v === "") return "";
    if (typeof v !== "string" || v.length > max) throw new WindError(`${key} 格式无效`);
    return v.trim();
  };
  const rawAliases = typeof r.aliases === "string" ? r.aliases.split(/[;；]/) : r.aliases ?? [];
  if (!Array.isArray(rawAliases) || rawAliases.length > 30 || rawAliases.some(a => typeof a !== "string" || a.trim().length < 4 || a.length > 200)) throw new WindError("别名需为 4–200 字，可用分号分隔，最多 30 个");
  if (r.priority !== undefined && r.priority !== "" && !["high", "normal"].includes(String(r.priority))) throw new WindError("关注等级只能为 high 或 normal");
  if (r.enabled !== undefined && typeof r.enabled !== "boolean") throw new WindError("enabled 必须为布尔值");
  return { id: r.id, name: r.name.trim(), province: text("province"), city: text("city"), developer: text("developer", 200) || null,
    capacityMw: capacityMw(r.capacityMw), aliases: [...new Set((rawAliases as string[]).map(a => a.trim()))].sort(), priority: r.priority === "high" ? "high" : "normal", enabled: r.enabled !== false };
}

/** RFC 4180 quoting; malformed rows never silently shift capacity or project IDs. */
export function parseCsv(csv: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false; let closed = false;
  const text = csv.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else cell += c;
    } else if (c === '"') {
      if (cell || closed) throw new WindError("CSV 引号位置无效"); quoted = true;
    } else if (c === ",") { row.push(cell); cell = ""; closed = false; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); if (row.some(v => v.trim())) rows.push(row); row = []; cell = ""; closed = false;
    } else { if (closed) throw new WindError("CSV 结束引号后只能是分隔符"); cell += c; }
  }
  if (quoted) throw new WindError("CSV 存在未闭合的引号");
  row.push(cell); if (row.some(v => v.trim())) rows.push(row);
  return rows;
}
export function parseProjectImport(input: { csv?: unknown; projects?: unknown }): { rows: WindProjectInput[]; errors: string[] } {
  let raw: unknown[];
  try {
    if (typeof input.csv === "string") {
      if (input.csv.length > 2_000_000) throw new WindError("CSV 超过大小限制");
      const [header, ...data] = parseCsv(input.csv);
      if (!header || !header.includes("id") || !header.includes("name") || new Set(header).size !== header.length) throw new WindError("CSV 表头需包含 id、name 且不能重复");
      raw = data.map((cells, i) => { if (cells.length !== header.length) throw new WindError(`第 ${i + 2} 行列数不一致`); return Object.fromEntries(header.map((key, j) => [key, cells[j]])); });
    } else if (Array.isArray(input.projects)) raw = input.projects;
    else throw new WindError("请提供 CSV 或 projects 数组");
    if (!raw.length || raw.length > 1000) throw new WindError("每次需导入 1–1000 个项目");
  } catch (error) { return { rows: [], errors: [(error as Error).message] }; }
  const rows: WindProjectInput[] = []; const errors: string[] = []; const ids = new Set<string>();
  for (const [i, r] of raw.entries()) {
    try { const p = projectInput(r); if (ids.has(p.id)) throw new WindError(`ID ${p.id} 重复`); ids.add(p.id); rows.push(p); }
    catch (error) { errors.push(`第 ${i + 1} 个项目：${(error as Error).message}`); }
  }
  return { rows, errors };
}
export function inputDigest(value: unknown): string { return sha256(JSON.stringify(value)); }

export interface RuleCandidate {
  projectId: string | null; matches: string[]; field: WindField; value: string | number;
  quote: string; eventDate: string | null; planned: boolean; scope: string; note: string;
}
const RULES: Array<{ pattern: RegExp; field: WindField; value: string }> = [
  { pattern: /全容量(?:并网|投产)|全部(?:机组)?并网/, field: "grid", value: "全容量并网" },
  { pattern: /首次并网|首(?:台|批)(?:机组)?并网/, field: "grid", value: "首次并网" },
  { pattern: /首台(?:风机)?(?:完成)?吊装|首台(?:风机)?吊装(?:完成)?/, field: "installation", value: "首台吊装" },
  { pattern: /全部(?:风机)?吊装完成|吊装全部完成/, field: "installation", value: "吊装完成" },
  { pattern: /正式开工|已开工|开工建设|开工仪式/, field: "construction", value: "已开工" },
  { pattern: /核准变更|变更核准|核准.*调整/, field: "approval", value: "核准变更" },
  { pattern: /获(?:得)?核准|核准批复|核准文件/, field: "approval", value: "已核准" },
  { pattern: /中标(?:结果|公告|公示|通知书)|确定中标/, field: "procurement", value: "中标" },
  { pattern: /招标公告|公开招标|启动招标/, field: "procurement", value: "招标" },
  { pattern: /(?:取消|终止)招标|采购取消/, field: "procurement", value: "采购取消" },
  { pattern: /延期|延后/, field: "exception", value: "延期" },
  { pattern: /暂停建设|暂停施工/, field: "exception", value: "暂停" },
  { pattern: /项目取消|取消(?:该)?项目/, field: "exception", value: "取消" },
];
export function matchProjects(text: string, projects: WindProjectInput[]): string[] {
  const normalized = text.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  return projects.filter(p => p.enabled && [p.name, ...p.aliases].some(a => {
    const name = a.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
    if (!name) return false;
    let from = 0;
    for (;;) {
      const index = normalized.indexOf(name, from); if (index < 0) return false;
      const next = normalized[index + name.length] ?? "";
      // 三山岛十 must not match 三山岛十一; the same applies to numbered and Roman sites.
      if (!(/[一二三四五六七八九十百]$/.test(name) && /^[一二三四五六七八九十百]/.test(next)) &&
          !(/\d$/.test(name) && /^\d/.test(next)) &&
          !(/[ivx]$/.test(name) && /^[ivx]/.test(next))) return true;
      from = index + name.length;
    }
  })).map(p => p.id).sort();
}
function statedDate(text: string): string | null {
  const dates = [...text.matchAll(/(20\d{2})[年/-](\d{1,2})[月/-](\d{1,2})日?/g)];
  if (dates.length !== 1) return null;
  try { return dateOnly(`${dates[0][1]}-${dates[0][2].padStart(2,"0")}-${dates[0][3].padStart(2,"0")}`); } catch { return null; }
}
/** High precision starter rules. All output is pending; no rule is a fact confirmation. */
export function extractWindRules(body: string, projects: WindProjectInput[]): RuleCandidate[] {
  const out: RuleCandidate[] = [];
  for (const quote of body.split(/[。！？\n]/).map(s => s.trim()).filter(Boolean)) {
    const matches = matchProjects(quote, projects); if (!matches.length) continue;
    const planned = /计划|预计|拟(?:于|在|建|开工)|力争|将(?:于|在|实现)|有望|争取/.test(quote);
    if (/尚未|未(?:获|开工|并网)|未能|并未|没有|暂不|是否/.test(quote)) continue;
    // A phase already in the registered project's name identifies that project, not a sub-scope.
    const names = projects.filter(p => matches.includes(p.id)).flatMap(p => [p.name, ...p.aliases]).sort((a,b) => b.length - a.length);
    let scopeText = quote;
    for (const name of names) scopeText = scopeText.replaceAll(name, "");
    const scopeMatch = /(?:第?[一二三四五六七八九十\d]+期|(?:EPC|海缆|风机|施工|升压站|基础|送出|安装|勘察|设计|[A-Za-z0-9-]+)(?:采购|工程|施工)?标段)/.exec(scopeText);
    const scope = scopeMatch ? scopeMatch[0] : "project";
    const base = { projectId: matches.length === 1 ? matches[0] : null, matches, quote, eventDate: statedDate(quote), planned, scope,
      note: [matches.length > 1 ? "同句涉及多个项目，请指定归属" : "规则识别，请核对原文", scope !== "project" ? "仅适用于该分期或标段" : "请确认是否适用于整个项目", planned ? "计划表述，不更新实际里程碑" : ""].filter(Boolean).join("；") };
    if (planned) {
      const d = statedDate(quote);
      if (/并网/.test(quote) && d) out.push({ ...base, field: "plannedGridDate", value: d });
      continue;
    }
    for (const rule of RULES) if (rule.pattern.test(quote)) {
      if (rule.value === "已核准" && /变更|调整/.test(quote)) continue;
      if (rule.value === "招标" && /中标|取消|终止/.test(quote)) continue;
      if (rule.value === "首次并网" && /全容量|全部/.test(quote)) continue;
      out.push({ ...base, field: rule.field, value: rule.value });
    }
    const m = /(?:装机容量|核准容量|容量调整为|装机规模)(?:为|由|达到|调整为)?\s*(\d+(?:\.\d+)?\s*(?:万千瓦|千瓦|兆瓦|MW|GW))/i.exec(quote);
    if (m && !/由.*(?:调整|变更|增至|减至)/.test(quote)) out.push({ ...base, field: "capacityMw", value: capacityMw(m[1])! });
    const change = /(?:容量|装机规模).*?(?:调整为|增至|减至|变更为)\s*(\d+(?:\.\d+)?\s*(?:万千瓦|千瓦|兆瓦|MW|GW))/i.exec(quote);
    if (change) out.push({ ...base, field: "capacityMw", value: capacityMw(change[1])! });
  }
  const unique = new Map(out.map(c => [inputDigest([c.matches, c.field, c.scope, c.value, c.quote]), c]));
  return [...unique.values()].slice(0, 100);
}

export function csvCell(value: unknown): string {
  const text = String(value ?? "");
  // Spreadsheet applications execute formula cells even when correctly CSV-quoted.
  const safe = /^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
