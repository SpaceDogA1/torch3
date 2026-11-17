import { useHandleNewThread } from "~/hooks/useHandleNewThread";

/** Opens Orchestry on the project of the thread in view, when there is one. */
export function useActiveOrchestrySearch() {
  const { activeDraftThread, activeThread } = useHandleNewThread();
  const thread = activeThread ?? activeDraftThread;
  return thread ? { environmentId: thread.environmentId, projectId: thread.projectId } : {};
}
