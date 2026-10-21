"""Process settings. Secrets come from the environment, never from defaults."""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore", env_file=None)

    database_url: str = ""
    email_live_send_enabled: bool = False
    email_provider: str = ""
    email_allowed_recipient_domains: str = ""
    email_mock_inbound_enabled: bool = False
    graph_tenant_id: str = ""
    graph_client_id: str = ""
    graph_client_secret: str = Field(default="", repr=False)
    shared_mailbox_address: str = ""
    # Live email over SMTP (smtp_mailbox.py): send only, to the allowed domains.
    smtp_host: str = ""
    smtp_port: int = Field(default=465, ge=1, le=65535)
    # True: TLS from the start (port 465). False: STARTTLS on a plain connection (587).
    smtp_secure: bool = True
    smtp_user: str = Field(default="", repr=False)
    smtp_password: str = Field(default="", repr=False)
    email_from: str = ""
    app_base_url: str = ""
    # Where links that leave the app point (the secure upload link and the welcome email's
    # sign-in link), when that differs from app_base_url: for example the machine's address
    # on the local network. Empty uses app_base_url.
    public_base_url: str = ""

    def link_base_url(self) -> str:
        """The base of links sent outside the app, without a trailing slash."""
        return (self.public_base_url.strip() or self.app_base_url.strip()).rstrip("/")

    oidc_issuer_url: str = ""
    oidc_client_id: str = ""
    oidc_client_secret: str = ""
    oidc_redirect_url: str = ""
    google_client_id: str = ""
    google_client_secret: str = Field(default="", repr=False)
    google_redirect_url: str = ""
    # Comma-separated DNS servers for the invitation mail-domain check. Empty uses the
    # machine's own resolvers.
    dns_nameservers: str = ""
    session_ttl_seconds: int = Field(default=28800, ge=60)
    login_attempt_ttl_seconds: int = Field(default=600, ge=60)
    session_cookie_secure: bool = True
    preview_login_enabled: bool = False
    # Where the process runs: "production" for real engagements. Development switches,
    # like turning the independence rules off, are refused there.
    app_env: str = ""
    # The independent-review rules (see independence.py). Leave true for real engagements.
    review_independence_required: bool = True
    workflow_provider: str = ""
    workflow_address: str = ""
    model_provider: str = ""
    model_api_key: str = Field(default="", repr=False)
    # The BALANCED tier's model when MODEL_BALANCED is empty (kept from before the tiers).
    model_name: str = ""
    # Milestone 3a: three configurable tiers, each a pinned model of the provider
    # (model_providers.py names the defaults and their prices). Empty takes the default.
    model_fast: str = ""
    model_balanced: str = ""
    model_deep: str = ""
    # Prices for models the table does not know, as JSON: {"model-id": [input, output]}
    # in dollars per million tokens. A live model without a price is refused.
    model_prices: str = ""
    # The DEEP tier is explicitly authorized work only: the roster keys listed here
    # (comma-separated, for example "independent-reviewer,engagement-planner") run on it;
    # every other agent runs on FAST or BALANCED as model_providers.AGENT_TIERS says.
    model_deep_agents: str = ""
    # Containment: a live model call that does not go through the agent caller (no tier,
    # no budget, no provenance) is refused unless this is true. Development only; never
    # for real engagements. Each refusal is logged.
    model_allow_unmetered: bool = False
    # Budgets in micro-dollars (1,000,000 = $1). Provisional development defaults: $1 a
    # call, $10 a job, $50 an engagement a calendar month. 0 means no limit, for tests
    # with a stubbed provider. A call past a limit is refused before dispatch and
    # recorded as BUDGET_EXCEEDED.
    model_budget_call_micros: int = Field(default=1_000_000, ge=0)
    model_budget_job_micros: int = Field(default=10_000_000, ge=0)
    model_budget_engagement_month_micros: int = Field(default=50_000_000, ge=0)
    # The key that encrypts stored prompts and answers (provenance.py): 32 bytes,
    # base64. Without it, only hashes are kept. Never logged.
    provenance_key: str = Field(default="", repr=False)
    # Earlier provenance keys, comma-separated, kept so content sealed under them stays
    # readable after a rotation. Each key is identified by its id (sha256 prefix).
    provenance_previous_keys: str = Field(default="", repr=False)
    # How long encrypted prompts and answers are kept before the deploy step removes
    # them. The hashes and the call record stay.
    model_content_retention_days: int = Field(default=90, ge=1, le=3650)
    # Live tests against the provider run only when this is true (MODEL_LIVE_TESTS=1).
    model_live_tests: bool = False
    # Runs background work, such as drafting evidence requests, in the API process when
    # no workflow engine is configured. For local development.
    local_worker_enabled: bool = False
    # How many background jobs the local worker runs at once: evidence request drafts,
    # scoping reviews, system scans, and evidence analyses share these threads. Each
    # draft is one model call of a few seconds, so 80 requests take minutes on 2 threads
    # and well under one on 6.
    local_worker_threads: int = Field(default=6, ge=1, le=16)
    # The local OCR engine for screenshots and scanned pages. Empty means `tesseract` on
    # the PATH. Without it, such files are marked for a person to read.
    ocr_tesseract_path: str = ""
    ocr_languages: str = Field(default="eng", pattern=r"^[a-z_]{3,16}(\+[a-z_]{3,16}){0,4}$")
    s3_endpoint_url: str = ""
    s3_bucket: str = ""
    s3_access_key_id: str = ""
    s3_secret_access_key: str = Field(default="", repr=False)
    s3_region: str = ""

    def s3_configured(self) -> bool:
        return (
            self.s3_endpoint_url.strip() != ""
            and self.s3_bucket.strip() != ""
            and self.s3_access_key_id.strip() != ""
            and self.s3_secret_access_key != ""
        )

    def oidc_configured(self) -> bool:
        return (
            self.oidc_issuer_url != ""
            and self.oidc_client_id != ""
            and self.oidc_client_secret != ""
            and self.oidc_redirect_url != ""
        )

    def google_configured(self) -> bool:
        return (
            self.google_client_id != ""
            and self.google_client_secret != ""
            and self.google_redirect_url != ""
        )
