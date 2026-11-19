import { GoogleMark, MicrosoftMark } from "./provider-marks";
import {
  SIGN_IN_LEADS,
  SIGN_IN_NOTICES,
  type SignInNotice,
  type SignInProviders,
  signInLead,
  withReturn,
} from "./sign-in-model";
import { UiIcon } from "./ui-icon";

/**
 * The sign-in page. A Google or Microsoft account signs an existing member in; a
 * new person gets a workspace of their own on the same click. Sent here from a workspace
 * address (`returnTo`), every way in comes back to it, and the lead says so.
 */
export function SignInPage({
  providers,
  notice,
  apiBase,
  returnTo,
}: {
  providers: SignInProviders | null;
  notice: SignInNotice | null;
  apiBase: string;
  returnTo: string | null;
}) {
  const google = providers?.providers.find((item) => item.id === "google");
  const microsoft = providers?.providers.find((item) => item.id === "entra");
  const preview = providers?.preview === true;
  const shownNotice: SignInNotice | null =
    providers === null ? "unavailable" : notice;
  const nothing = providers !== null && !google && !microsoft && !preview;
  const lead = (
    <p className="si-lead">
      {SIGN_IN_LEADS[signInLead(returnTo, shownNotice)]}
    </p>
  );
  // An ended session says why the person is here before where they will return to.
  const reasonFirst = shownNotice === "expired";
  return (
    <div className="si theme-light">
      <div className="si-glow" aria-hidden="true" />
      <main className="si-card">
        <a className="si-brand" href="/welcome">
          <span className="si-logo" aria-hidden="true">
            <UiIcon name="logo" size={18} />
          </span>
          Audit Workforce
        </a>
        <h1>Sign in</h1>
        {reasonFirst ? null : lead}
        {shownNotice !== null ? (
          <p className="si-notice" role="alert">
            <UiIcon name="info" size={14} />
            {SIGN_IN_NOTICES[shownNotice]}
          </p>
        ) : null}
        {reasonFirst ? lead : null}
        <div className="si-buttons">
          {google ? (
            <a
              className="si-btn"
              href={withReturn(`${apiBase}${google.loginPath}`, returnTo)}
            >
              <GoogleMark size={18} />
              Continue with Google
            </a>
          ) : null}
          {microsoft ? (
            <a
              className="si-btn"
              href={withReturn(`${apiBase}${microsoft.loginPath}`, returnTo)}
            >
              <MicrosoftMark size={17} />
              Continue with Microsoft
            </a>
          ) : null}
          {preview ? (
            <a
              className="si-btn si-btn-preview"
              href={withReturn(`${apiBase}/auth/preview`, returnTo)}
            >
              <UiIcon name="sparkles" size={16} />
              Open the local preview
            </a>
          ) : null}
          {nothing ? (
            <p className="si-none">
              No sign-in provider is configured for this installation yet.
            </p>
          ) : null}
        </div>
        <ul className="si-points">
          <li>
            <UiIcon name="check" size={13} />
            We never see your password; your provider verifies you.
          </li>
          <li>
            <UiIcon name="check" size={13} />
            Sessions end after eight hours and can be revoked any time.
          </li>
        </ul>
        <p className="si-fine">
          <a href="/welcome">
            <UiIcon name="arrow" size={13} />
            Back to the overview
          </a>
        </p>
      </main>
    </div>
  );
}
