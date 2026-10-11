"""Process settings. Secrets come from the environment, never from defaults."""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore", env_file=None)

    database_url: str = ""
    email_live_send_enabled: bool = False
    email_provider: str = ""
    email_allowed_recipient_domains: str = ""
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
    model_api_key: str = ""
    model_name: str = ""

    def oidc_configured(self) -> bool:
        return (
            self.oidc_issuer_url != ""
            and self.oidc_client_id != ""
            and self.oidc_client_secret != ""
            and self.oidc_redirect_url != ""
        )
