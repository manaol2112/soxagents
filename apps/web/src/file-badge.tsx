/** A file's type at a glance, by its extension: PDF, DOC, XLS, IMG, ZIP, or FILE. Used
 * by the evidence dialog and by an evidence item's file cards. */
const EXT_KIND: Record<string, string> = {
  pdf: "PDF",
  doc: "DOC",
  docx: "DOC",
  xls: "XLS",
  xlsx: "XLS",
  csv: "XLS",
  png: "IMG",
  jpg: "IMG",
  jpeg: "IMG",
  gif: "IMG",
  webp: "IMG",
  zip: "ZIP",
};

export function FileBadge({
  name,
  small = false,
}: {
  name: string;
  small?: boolean;
}) {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const kind = EXT_KIND[ext] ?? "FILE";
  return (
    <span
      className={`ei-badge kind-${kind.toLowerCase()}${small ? " is-small" : ""}`}
      aria-hidden="true"
    >
      {kind}
    </span>
  );
}
