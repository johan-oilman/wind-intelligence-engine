export const WIND_FIELDS = {
  capacityMw: "装机容量（MW）", developer: "开发主体", approval: "核准",
  procurement: "采购", construction: "施工", installation: "吊装", grid: "并网",
  exception: "异常", plannedGridDate: "计划并网日期",
} as const;
export type WindField = keyof typeof WIND_FIELDS;
export const WIND_VALUES: Partial<Record<WindField, readonly string[]>> = {
  approval: ["已核准", "核准变更"], procurement: ["招标", "中标", "采购取消"],
  construction: ["已开工"], installation: ["首台吊装", "吊装完成"],
  grid: ["首次并网", "全容量并网"], exception: ["延期", "暂停", "取消"],
};
export interface WindProjectInput {
  id: string; name: string; province: string; city: string; developer: string | null;
  capacityMw: number | null; aliases: string[]; priority: "high" | "normal"; enabled: boolean;
}
export interface WindProject extends WindProjectInput { version: number; pending: number; updatedAt: string }
export interface WindFact {
  field: WindField; scope: string; value: string | number; eventDate: string | null;
  changeId: string; evidenceId: string;
}
export interface WindEvidence {
  id: string; url: string; title: string; publisher: string; body: string; tier: string;
  publishedAt: string | null; discoveredAt: string; articleId: string | null; hash: string;
}
export interface WindCandidate {
  id: string; projectId: string | null; projectName: string | null; matches: string[];
  evidenceId: string; field: WindField; scope: string; value: string | number; quote: string;
  eventDate: string | null; planned: boolean; status: "pending" | "accepted" | "rejected";
  note: string; extractor: string; title: string; url: string; publisher: string;
  publishedAt: string | null; discoveredAt: string; tier: string;
}
export interface WindChange {
  id: string; projectId: string; projectName: string; candidateId: string;
  field: WindField; scope: string; before: string | number | null; after: string | number;
  eventDate: string | null; confirmedAt: string; applied: boolean;
  kind: "live" | "supplement" | "historical" | "correction";
  reason: string; actor: string; evidenceId: string; title: string; url: string; quote: string;
}
export interface WindImportPreview {
  rows: WindProjectInput[]; changes: Array<{ id: string; name: string; action: "create" | "update" | "unchanged"; version: number | null }>;
  errors: string[]; token: string | null;
}
export interface WindOverview { projects: number; pending: number; confirmed: number; unresolved: number }
export interface WindCoverage {
  projectId: string; projectName: string; sourceId: string; sourceName: string; enabled: boolean;
  health: string; lastOkAt: string | null; lastFetchAt: string | null; nextFetchAt: string | null;
  lastError: string | null; intervalMinutes: number; status: "ok" | "failed" | "paused" | "unchecked" | "overdue";
}
export interface WindBrief {
  day: string; from: string; through: string; changes: WindChange[]; pending: number;
  coverage: WindCoverage[]; unconfigured: number; markdown: string;
}

export interface WindHistoryEvent {
  projectHint: string; eventType: string; eventDate: string | null; summary: string;
  sourceName: string; sourceUrl: string | null; risk: string; suggestedStage: string;
}
export interface WindHistoryRecord {
  id: string; origin: "gmail" | "conversation" | "file"; externalId: string; archiveUrl: string | null;
  title: string; body: string; sourceAt: string | null; importedAt: string;
  events: WindHistoryEvent[]; parseNote: string; notification: "sent_record" | "not_sent" | "unknown";
  projects: Array<{ id: string; name: string; method: "name_match" | "manual" }>;
}
