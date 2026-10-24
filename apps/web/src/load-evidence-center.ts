import { cookies } from "next/headers";

import {
  apiQuery,
  type CenterList,
  type CenterQuery,
  parseCenterList,
} from "./evidence-center-model";
import { apiGet, sessionToken } from "./load-workspace";
import {
  type Contact,
  parseContacts,
  parseRequestDetails,
  type RequestDetails,
} from "./request-details-model";
import { type GroupView, parseGroupView } from "./request-group-model";
import type { ShellModel } from "./shell-model";

export type EvidenceCenterState = {
  query: CenterQuery;
  /** Null when it could not be loaded. */
  list: CenterList | null;
  /** The request open in the side panel. */
  details: RequestDetails | null;
  /** The request to one person for several controls open in the side panel. */
  group: GroupView | null;
  /** The engagement's people at the client, for assigning owners. */
  contacts: Contact[];
};

/** The Evidence page's request list for its query, and the request open beside it. Read
 * only on the Requests tab. */
export async function loadEvidenceCenter(
  model: ShellModel,
  query: CenterQuery,
  tab: string | null,
): Promise<EvidenceCenterState | null> {
  if (
    model.status !== "ready" ||
    model.section !== "evidence" ||
    model.selectedProject === null ||
    (tab !== null && tab !== "requests")
  ) {
    return null;
  }
  const session = sessionToken((await cookies()).get("aw_session")?.value);
  const base = `/organizations/${model.organization.id}/projects/${model.selectedProject.id}`;
  // The list as the person sees it: requests travelling together are one request.
  const [list, details, group, contacts] = await Promise.all([
    apiGet(`${base}/evidence-requests?${apiQuery(query)}&grouped=1`, session),
    query.request === null
      ? null
      : apiGet(`${base}/pbc-requests/${query.request}/details`, session),
    query.group === null
      ? null
      : apiGet(`${base}/evidence-groups/${query.group}`, session),
    apiGet(`${base}/engagement-contacts`, session),
  ]);
  return {
    query,
    list: list.status === 200 ? parseCenterList(list.body) : null,
    details:
      details !== null && details.status === 200
        ? parseRequestDetails(details.body)
        : null,
    group:
      group !== null && group.status === 200
        ? parseGroupView(group.body)
        : null,
    contacts: contacts.status === 200 ? parseContacts(contacts.body) : [],
  };
}
