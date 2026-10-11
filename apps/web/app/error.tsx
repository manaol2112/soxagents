"use client";

export default function WorkspaceError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="content" id="content">
      <section className="state-panel">
        <h1>Workspace unavailable</h1>
        <p>The workspace could not be loaded. Wait a moment and try again.</p>
        <button type="button" className="btn-secondary" onClick={() => reset()}>
          Try again
        </button>
      </section>
    </main>
  );
}
