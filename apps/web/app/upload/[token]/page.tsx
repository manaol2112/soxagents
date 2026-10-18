import type { Metadata } from "next";

import { forward, portalSession } from "../../../src/portal-api";
import {
  parseLinkStatus,
  parsePortal,
  validToken,
} from "../../../src/portal-model";
import { PortalPage } from "../../../src/portal-view";

export const dynamic = "force-dynamic";

// The link's token is in this page's address: it is never sent on to another site.
export const metadata: Metadata = {
  title: "Evidence requests — AI Workforce",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

type UploadProps = { params: Promise<{ token: string }> };

/** The evidence owner's page: no account, the link and a code sent to their address. */
export default async function Upload({ params }: UploadProps) {
  const { token } = await params;
  const found = validToken(token)
    ? await forward(`/links/${token}`, { method: "GET" })
    : { status: 404, body: null };
  const status = found.status === 200 ? parseLinkStatus(found.body) : null;
  // A verified visit carries on after a reload, while the session lasts.
  const session =
    status?.state === "ACTIVE" ? await portalSession() : undefined;
  const opened =
    session === undefined
      ? null
      : await forward("/session", { method: "GET", session });
  const portal = opened?.status === 200 ? parsePortal(opened.body) : null;
  return (
    <PortalPage
      token={token}
      status={status}
      unavailable={found.status !== 200 && found.status !== 404}
      portal={portal}
    />
  );
}
