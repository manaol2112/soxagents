/** A policy or procedure on file proposed as evidence for a request's item (decided by the
 * product owner on 28 October 2026): what the API answers (policy_evidence.py), and what
 * the item says. The agent proposes; nothing is evidence until a person uses it. */

export type PolicyProposal = {
  id: string;
  itemId: string;
  documentId: string;
  title: string;
  kind: string;
  fileName: string;
  reason: string;
  quote: string;
  /** Its original file is kept; one uploaded before is replaced first. */
  usable: boolean;
  /** When the document says it took effect ("1 Oct 2024"); empty when it says none. */
  effective: string;
};

/** A policy or procedure that applies to the control, to file on an item by choice. */
export type PolicyDocument = {
  id: string;
  title: string;
  kind: string;
  usable: boolean;
  effective: string;
};

export type PolicyEvidence = {
  checking: boolean;
  proposals: PolicyProposal[];
  documents: PolicyDocument[];
};

export const NO_POLICY_EVIDENCE: PolicyEvidence = {
  checking: false,
  proposals: [],
  documents: [],
};

const str = (value: unknown) => (typeof value === "string" ? value : "");

export function parsePolicyEvidence(value: unknown): PolicyEvidence | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.proposals)) {
    return null;
  }
  return {
    checking: v.checking === true,
    proposals: v.proposals
      .filter(
        (p): p is Record<string, unknown> =>
          typeof p === "object" && p !== null,
      )
      .map((p) => ({
        id: str(p.id),
        itemId: str(p.requirement_id),
        documentId: str(p.document_id),
        title: str(p.document_title),
        kind: str(p.document_kind),
        fileName: str(p.file_name),
        reason: str(p.reason),
        quote: str(p.quote),
        usable: p.usable === true,
        effective: str(p.effective),
      }))
      .filter((p) => p.id !== "" && p.itemId !== "" && p.title !== ""),
    documents: (Array.isArray(v.documents) ? v.documents : [])
      .filter(
        (d): d is Record<string, unknown> =>
          typeof d === "object" && d !== null,
      )
      .map((d) => ({
        id: str(d.id),
        title: str(d.title),
        kind: str(d.kind),
        usable: d.usable === true,
        effective: str(d.effective),
      }))
      .filter((d) => d.id !== "" && d.title !== ""),
  };
}

/** The documents a person can file on an item: those not already proposed for it, the
 * ones with their file kept first. */
export function choosable(
  evidence: PolicyEvidence,
  itemId: string,
): PolicyDocument[] {
  const proposed = new Set(
    proposalsFor(evidence, itemId).map((p) => p.documentId),
  );
  return evidence.documents
    .filter((d) => !proposed.has(d.id))
    .sort((a, b) => Number(b.usable) - Number(a.usable));
}

/** The proposals for one item, in the order the agent made them. */
export function proposalsFor(
  evidence: PolicyEvidence,
  itemId: string,
): PolicyProposal[] {
  return evidence.proposals.filter((p) => p.itemId === itemId);
}

/** "Policy", "Procedure". */
export function kindLabel(kind: string): string {
  return kind === "PROCEDURE" ? "Procedure" : "Policy";
}

/** Whether the item still waits for the agent: it asks for a document of the process, the
 * agent is reading, and nothing is proposed for it yet. */
export function stillChecking(
  evidence: PolicyEvidence,
  item: { id: string; categories: readonly string[] },
): boolean {
  return (
    evidence.checking &&
    item.categories.includes("PROCESS_DOCUMENTATION") &&
    proposalsFor(evidence, item.id).length === 0
  );
}

/** Systems & Processes, on its policies and procedures, opened on one document when named
 * (where it is read, and replaced). */
export function policiesHref(
  ids: { organizationId: string; projectId: string },
  documentId?: string,
): string {
  return `/?${new URLSearchParams({
    organization: ids.organizationId,
    project: ids.projectId,
    section: "controls",
    pane: "policies",
    ...(documentId === undefined ? {} : { document: documentId }),
  }).toString()}`;
}

/** The document's line under its title: "Policy · Effective 1 Oct 2024 · On file". A
 * document uploaded before its file was kept is on file as its text only. */
export function documentLine(
  proposal: Pick<PolicyProposal, "kind" | "effective" | "usable">,
): string {
  return [
    kindLabel(proposal.kind),
    proposal.effective === "" ? "" : `Effective ${proposal.effective}`,
    proposal.usable ? "On file" : "Text only",
  ]
    .filter((part) => part !== "")
    .join(" · ");
}

/** What the person sees when using or dismissing a proposal did not work. */
export function decisionProblem(status: number, detail: string): string {
  if (status === 409 && detail !== "") {
    return detail;
  }
  if (status === 403 || status === 404) {
    return "Only the engagement team can use a policy as evidence.";
  }
  return "That did not work. Try again.";
}
