/** Home before the firm's first engagement (the product owner's getting-started
 * reference, 27 October 2026): what the page says and whether it offers to start. */

export type FirstEngagementStep = {
  number: string;
  icon: "userPlus" | "file" | "chart";
  title: string;
  detail: string;
};

/** The three steps, in the order the engagement form and setup take them. Examples name
 * the methodologies the form offers (onboarding-model METHODOLOGIES), not other ones. */
export const FIRST_ENGAGEMENT_STEPS: readonly FirstEngagementStep[] = [
  {
    number: "01",
    icon: "userPlus",
    title: "Add a client",
    detail: "Keep engagements organized under your clients.",
  },
  {
    number: "02",
    icon: "file",
    title: "Define engagement",
    detail: "Set the methodology and period (e.g. SOX 404, internal audit).",
  },
  {
    number: "03",
    icon: "chart",
    title: "Start working",
    detail: "Plan, manage controls, and review.",
  },
];

export type FirstEngagementCopy = {
  title: string;
  lead: string;
  /** The create action; null when the viewer's role cannot open an engagement. */
  action: { label: string; notes: readonly string[] } | null;
  /** Shown in place of the action to a member who cannot create one. */
  waiting: string | null;
};

/** The page's words for the viewer: owners, admins and project managers create the
 * engagement (canManageProjects); every other member is told who can. */
export function firstEngagementCopy(canCreate: boolean): FirstEngagementCopy {
  if (canCreate) {
    return {
      title: "Let’s create your first engagement",
      lead: "Set up a client, define your scope, and bring your assurance work into one workspace.",
      action: {
        label: "Create first engagement",
        notes: ["About 3 minutes", "You can change details before launch"],
      },
      waiting: null,
    };
  }
  return {
    title: "No engagements yet",
    lead: "Engagements you are added to appear here, with their scope, work, evidence, and decisions in one place.",
    action: null,
    waiting:
      "An owner, admin, or project manager creates the engagement and adds you to it.",
  };
}
