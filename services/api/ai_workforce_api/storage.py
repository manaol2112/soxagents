"""Object storage. The mock keeps bytes in PostgreSQL. S3 is used when it is configured."""

import hashlib
import logging
from datetime import UTC, datetime
from typing import Any, Protocol, runtime_checkable

import psycopg

from ai_workforce_api.settings import Settings

logger = logging.getLogger(__name__)

# How long a call to object storage may wait to connect and to read, in seconds. Without
# them botocore waits a minute for each, and a route holds its worker meanwhile.
S3_CONNECT_TIMEOUT_SECONDS = 10
S3_READ_TIMEOUT_SECONDS = 60


def _storage_errors() -> tuple[type[BaseException], ...]:
    """What botocore raises when storage refuses a call (ClientError) or cannot be reached at
    all (BotoCoreError: no connection, a read timeout, a closed connection). Both are the
    store being unavailable, never an unhandled error."""
    from botocore.exceptions import BotoCoreError, ClientError

    return (ClientError, BotoCoreError)


class StoreError(Exception):
    def __init__(self, detail: str) -> None:
        self.detail = detail


class ObjectStore(Protocol):
    def put(self, key: str, content: bytes) -> str: ...

    def get(self, key: str) -> bytes: ...


@runtime_checkable
class DeletableStore(Protocol):
    """A store that can also remove an object, for files kept only for a while (exports)."""

    def delete(self, key: str) -> None: ...


@runtime_checkable
class ListableStore(Protocol):
    """A store that can name the objects under a prefix, with when each was stored, for
    the orphan sweep (storage_sweep.py)."""

    def list_keys(self, prefix: str) -> list[tuple[str, datetime]]: ...


class MockObjectStore:
    """Durable stand-in for S3. A key is written once."""

    def __init__(self, connection: psycopg.Connection[Any]) -> None:
        self._connection = connection

    def put(self, key: str, content: bytes) -> str:
        digest = hashlib.sha256(content).hexdigest()
        self._connection.execute(
            """
            INSERT INTO mock_objects (object_key, content, content_sha256)
            VALUES (%s, %s, %s)
            ON CONFLICT (object_key) DO NOTHING
            """,
            (key, content, digest),
        )
        row = self._connection.execute(
            "SELECT content_sha256 FROM mock_objects WHERE object_key = %s",
            (key,),
        ).fetchone()
        if row is None or row[0] != digest:
            raise StoreError("stored object changed")
        return digest

    def get(self, key: str) -> bytes:
        row = self._connection.execute(
            "SELECT content FROM mock_objects WHERE object_key = %s",
            (key,),
        ).fetchone()
        if row is None or not isinstance(row[0], (bytes, memoryview)):
            raise StoreError("stored object is missing")
        return bytes(row[0])

    def delete(self, key: str) -> None:
        self._connection.execute("DELETE FROM mock_objects WHERE object_key = %s", (key,))

    def list_keys(self, prefix: str) -> list[tuple[str, datetime]]:
        rows = self._connection.execute(
            "SELECT object_key, created_at FROM mock_objects WHERE object_key LIKE %s",
            (prefix.replace("%", "") + "%",),
        ).fetchall()
        return [(str(key), moment) for key, moment in rows]


class S3ObjectStore:
    """Private bucket. Keys come from the caller and are never logged with credentials."""

    def __init__(self, settings: Settings) -> None:
        import boto3
        from botocore.config import Config

        self._bucket = settings.s3_bucket.strip()
        self._client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_url.strip(),
            aws_access_key_id=settings.s3_access_key_id.strip(),
            aws_secret_access_key=settings.s3_secret_access_key,
            region_name=settings.s3_region.strip() or "us-east-1",
            config=Config(
                signature_version="s3v4",
                retries={"max_attempts": 2},
                connect_timeout=S3_CONNECT_TIMEOUT_SECONDS,
                read_timeout=S3_READ_TIMEOUT_SECONDS,
            ),
        )

    def put(self, key: str, content: bytes) -> str:
        from botocore.exceptions import ClientError

        digest = hashlib.sha256(content).hexdigest()
        try:
            found = self._client.head_object(Bucket=self._bucket, Key=key)
        except ClientError as error:
            code = str(error.response.get("Error", {}).get("Code", ""))
            if code not in {"404", "NoSuchKey", "NotFound"}:
                logger.warning("object storage could not be read")
                raise StoreError("object storage is unavailable") from None
            found = None
        except _storage_errors():
            logger.warning("object storage could not be read")
            raise StoreError("object storage is unavailable") from None
        if found is not None:
            stored = self.get(key)
            if hashlib.sha256(stored).hexdigest() != digest:
                raise StoreError("stored object changed")
            return digest
        try:
            self._client.put_object(Bucket=self._bucket, Key=key, Body=content)
        except _storage_errors():
            logger.warning("object storage could not be written")
            raise StoreError("object storage is unavailable") from None
        return digest

    def get(self, key: str) -> bytes:
        try:
            response = self._client.get_object(Bucket=self._bucket, Key=key)
            body = response["Body"].read()
        except _storage_errors():
            logger.warning("object storage could not be read")
            raise StoreError("object storage is unavailable") from None
        if not isinstance(body, bytes):
            raise StoreError("stored object is missing")
        return body

    def delete(self, key: str) -> None:
        try:
            self._client.delete_object(Bucket=self._bucket, Key=key)
        except _storage_errors():
            logger.warning("object storage could not be cleaned up")
            raise StoreError("object storage is unavailable") from None

    def list_keys(self, prefix: str) -> list[tuple[str, datetime]]:
        found: list[tuple[str, datetime]] = []
        try:
            pages = self._client.get_paginator("list_objects_v2").paginate(
                Bucket=self._bucket, Prefix=prefix
            )
            for page in pages:
                for item in page.get("Contents", []):
                    modified = item.get("LastModified") or datetime.now(UTC)
                    found.append((str(item["Key"]), modified))
        except _storage_errors():
            logger.warning("object storage could not be listed")
            raise StoreError("object storage is unavailable") from None
        return found


def open_store(settings: Settings, connection: psycopg.Connection[Any]) -> ObjectStore:
    if settings.s3_configured():
        return S3ObjectStore(settings)
    return MockObjectStore(connection)


def digest_of(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()
