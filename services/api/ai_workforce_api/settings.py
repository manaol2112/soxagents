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
    app_base_url: str = ""
    oidc_issuer_url: str = ""
    oidc_client_id: str = ""
    oidc_client_secret: str = ""
    oidc_redirect_url: str = ""
    session_ttl_seconds: int = Field(default=28800, ge=60)
    login_attempt_ttl_seconds: int = Field(default=600, ge=60)
    session_cookie_secure: bool = True
    preview_login_enabled: bool = False
    workflow_provider: str = ""
    workflow_address: str = ""
    model_provider: str = ""
    model_api_key: str = Field(default="", repr=False)
    model_name: str = ""
    # Runs background work, such as drafting evidence requests, in the API process when
    # no workflow engine is configured. For local development.
    local_worker_enabled: bool = False
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
