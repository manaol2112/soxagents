/** The full-screen loading state: the mark draws itself while the workforce gets ready. */
const STEPS = [
  "Waking the agent workforce",
  "Reading the engagement records",
  "Lining up controls and evidence",
  "Checking what needs you",
] as const;

export function LoadingScreen() {
  return (
    <div className="boot" role="status" aria-live="polite">
      <div className="boot-center">
        <div className="boot-glow" aria-hidden="true" />
        <div className="boot-mark" aria-hidden="true">
          <span className="boot-orbit">
            <span className="boot-dot" />
            <span className="boot-dot" />
            <span className="boot-dot" />
          </span>
          <svg viewBox="0 0 48 48" width="56" height="56" aria-hidden="true">
            <defs>
              <linearGradient id="boot-stroke" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#7c95ff" />
                <stop offset="100%" stopColor="#3b5bdb" />
              </linearGradient>
            </defs>
            <path
              className="boot-hex"
              d="M24 5 8 14.5v19L24 43l16-9.5v-19L24 5Z"
              pathLength={1}
            />
            <path
              className="boot-check"
              d="m16.5 24.5 5 5 10-11"
              pathLength={1}
            />
          </svg>
        </div>
        <p className="boot-name">Audit Workforce</p>
        <div className="boot-steps" aria-hidden="true">
          {STEPS.map((step) => (
            <span key={step}>{step}</span>
          ))}
        </div>
        <span className="sr-only">Loading</span>
        <div className="boot-bar" aria-hidden="true">
          <span />
        </div>
      </div>
    </div>
  );
}
