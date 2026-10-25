"use client";

import { useState } from "react";

import {
  ENGAGEMENT_FORM_ID,
  OPEN_GUIDE_EVENT,
  useEngagementFacts,
} from "./engagement-form-facts";
import {
  GUIDE_SEEN_KEY,
  type GuideClient,
  guideSteps,
} from "./engagement-guide-model";
import { SpotlightTour } from "./spotlight-tour";

/**
 * The setup agent's guide on the New engagement page (decided by the product owner): the
 * spotlight tour through the form, worded from the values entered so far, ending with
 * creating the engagement.
 */
export function EngagementGuide({
  clients,
}: {
  clients: readonly GuideClient[];
}) {
  const [open, setOpen] = useState(false);
  // Whatever the person enters is read back while the guide is open.
  const facts = useEngagementFacts({ clients }, open);
  return (
    <SpotlightTour
      steps={facts === null ? [] : guideSteps(facts)}
      seenKey={GUIDE_SEEN_KEY}
      openEvent={OPEN_GUIDE_EVENT}
      watch={facts}
      onOpenChange={setOpen}
      finish={{
        label: "Create engagement",
        onClick: () => {
          const form = document.getElementById(ENGAGEMENT_FORM_ID);
          if (form instanceof HTMLFormElement) {
            form.requestSubmit();
          }
        },
      }}
    />
  );
}
