/** One stop of an agent's guided tour: the parts of the page it points at (none for a
 * welcome or a closing stop), what the agent says, and whether what it asks for is done. */
export type TourStep = {
  id: string;
  targets: readonly string[];
  title: string;
  body: string[];
  done: boolean;
  /** The tab of the page the step's parts are on, when the page has tabs. */
  pane?: string;
};
