// The engagement's exports and reports on record (Step 5): what each is, who made it,
// and whether its file is still kept, as the API lists them. The download itself goes
// through the workspace route, which checks the person can see the engagement.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ExportListing = {
  id: string;
  dataset: string;
  title: string;
  fileFormat: string;
  fileName: string;
  createdAt: string;
  createdBy: string;
  asOf: string;
  rows: number;
  /** The file carries an AI-written narrative, labelled as such inside it. */
  narrative: boolean;
  /** The file is still kept; an expired export is listed without a download. */
  available: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

export function parseExports(value: unknown): ExportListing[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const found: ExportListing[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string" || !UUID.test(item.id)) {
      return null;
    }
    found.push({
      id: item.id,
      dataset: text(item.dataset),
      title: text(item.title) || text(item.dataset),
      fileFormat: text(item.file_format),
      fileName: text(item.file_name),
      createdAt: text(item.created_at),
      createdBy: text(item.created_by),
      asOf: text(item.as_of),
      rows: typeof item.row_count === "number" ? item.row_count : 0,
      narrative: item.narrative === true,
      available: item.available === true,
    });
  }
  return found;
}

/** Where an export downloads: through the workspace, as the person. */
export function exportDownloadHref(
  exportId: string,
  organizationId: string,
  projectId: string,
): string {
  const params = new URLSearchParams({
    organization: organizationId,
    project: projectId,
  });
  return `/workspace/exports/${exportId}?${params}`;
}

/** The reports first, newest first, then the record exports. */
export function reportsFirst(items: ExportListing[]): ExportListing[] {
  const isReport = (item: ExportListing) =>
    item.fileFormat === "pdf" || item.fileFormat === "docx";
  return [...items].sort((a, b) => {
    if (isReport(a) !== isReport(b)) {
      return isReport(a) ? -1 : 1;
    }
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export const FORMAT_WORDS: Record<string, string> = {
  pdf: "PDF",
  docx: "Word",
  xlsx: "Excel",
  csv: "CSV",
};
