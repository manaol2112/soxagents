import { GoogleMark, MicrosoftMark } from "./provider-marks";
import {
  SIGN_IN_NOTICES,
  type SignInNotice,
  type SignInProviders,
} from "./sign-in-model";
import { UiIcon } from "./ui-icon";

/**
 * The sign-in page. A Google or Microsoft account signs an existing member in; a
 * new person gets a workspace of their own on the same click.
 */
export function SignInPage({
  providers,
  notice,
  apiBase,
}: {
  providers: SignInProviders | null;
  notice: SignInNotice | null;
  apiBase: string;
}) {
  const google = providers?.providers.find((item) => item.id === "google");
  const microsoft = providers?.providers.find((item) => item.id === "entra");
  const preview = providers?.preview === true;
  const shownNotice: SignInNotice | null =
    providers === null ? "unavailable" : notice;
  const nothing = providers !== null && !google && !microsoft && !preview;
  return (
    <div className="si">
      <div className="si-glow" aria-hidden="true" />
      <main className="si-card">
        <a className="si-brand" href="/welcome">
          <span className="si-logo" aria-hidden="true">
            <UiIcon name="logo" size={18} />
          </span>
          AI Workforce
        </a>
        <h1>Sign in</h1>
        <p className="si-lead">
          New here? Continue with your account and your workspace is created in
          the same step. No password to set.
        </p>
        {shownNotice !== null ? (
          <p className="si-notice" role="alert">
            <UiIcon name="info" size={14} />
            {SIGN_IN_NOTICES[shownNotice]}
          </p>
        ) : null}
        <div className="si-buttons">
          {google ? (
            <a className="si-btn" href={`${apiBase}${google.loginPath}`}>
              <GoogleMark size={18} />
              Continue with Google
            </a>
          ) : null}
          {microsoft ? (
            <a className="si-btn" href={`${apiBase}${microsoft.loginPath}`}>
              <MicrosoftMark size={17} />
              Continue with Microsoft
            </a>
          ) : null}
          {preview ? (
            <a
              className="si-btn si-btn-preview"
              href={`${apiBase}/auth/preview`}
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
