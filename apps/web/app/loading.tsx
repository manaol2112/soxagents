import { WorkspaceView } from "../src/workspace-view";

export default function Loading() {
  return <WorkspaceView model={{ status: "loading" }} />;
}
