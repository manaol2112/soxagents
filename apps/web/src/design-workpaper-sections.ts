/**
 * The numbers of the D&I workpaper's sections, as the Document view and its print number
 * them (docs/design-workpaper.md, section 3.10; product owner, 16 November 2026: "Should
 * the procedure be first then the narrative will be the result of the procedure?"). The
 * procedures come before the understanding, which is their result.
 *
 * The one source of truth: the Document view's headings, every sentence of the product
 * that names a section of the D&I workpaper, the points' places and the review notes'
 * sections all read these. It is re-exported by design-workpaper-model.ts; it lives in a
 * module of its own, with no imports, so the models that design-workpaper-model.ts itself
 * imports (the conclusion's, the points') can read it without an import cycle.
 */
export const DW_SECTION = {
  objective: 1,
  procedures: 2,
  understanding: 3,
  walkthrough: 4,
  attributes: 5,
  ipe: 6,
  conclusion: 7,
} as const;

export type DwSection = (typeof DW_SECTION)[keyof typeof DW_SECTION];

/** Where the unnumbered "Tickmarks and evidence" stands in the document's order: right
 * after the conclusion. Its heading has no number; the review notes order and filter by
 * it. */
export const DW_TICKMARKS_ORDER = DW_SECTION.conclusion + 1;
