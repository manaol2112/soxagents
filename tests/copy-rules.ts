/**
 * The product's copy rules, shared by the source check (tests/client-copy.test.ts) and the
 * browser checks of the rendered screens (tests/browser/rules.ts).
 */

// Phrases that belong to the build, not to the people using it. A page that shows one
// of these is not client-ready: environment variables, storage details, internal
// identifiers, and placeholder plurals.
export const INTERNAL: readonly RegExp[] = [
  /MODEL_PROVIDER|MODEL_API_KEY|PREVIEW_LOGIN|GOOGLE_CLIENT/,
  /next deploy/i,
  /test mailbox/i,
  /checks? the hash|declared hash|is immutable/i,
  /OCR engine/i,
  /model provider/i,
  /Claude re-performed/,
  /control instances?\b/i,
  /registered actions/i,
  /reviewed (?:keyword )?rules/i,
  /\b(?:note|item|request|control|file)\(s\)/,
  /Secret-looking/,
  /agent definition/i,
  /managed by the platform/i,
  / tier`/,
  /\bAcme\b/,
  /\bClaude\b/,
];

// The neutral voice: never the agent in the first person (the pattern of the guide and
// panel tests, e.g. tests/engagement-guide.test.ts). "D&I" and "Type I" are not a person.
// "I" is matched as a capital only, so "i.e." is not a person either.
export const FIRST_PERSON =
  /\bI(?:'ll|'m)?\b|\b(?:[Mm]e|[Mm]y|[Ww]e|[Ll]et's)\b/;
export const NOT_A_PERSON = /\bD&I\b|\bType I{1,2}\b/g;

// Casual phrasing the product owner rejected (17 October 2026): helper text is
// client-facing and professional.
export const CASUAL: readonly RegExp[] = [
  /\bfor me\b/i,
  /\bYours to\b/,
  /\baddressed to no one\b/i,
  /\bNo one yet\b/i,
];
