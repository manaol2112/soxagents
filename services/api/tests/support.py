class Database:
    """Connection target for one temporary database. The URL is omitted from repr."""

    def __init__(self, url: str) -> None:
        self.url = url

    def __repr__(self) -> str:
        return "Database(<redacted>)"
