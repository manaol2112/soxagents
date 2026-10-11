"""Object storage. The mock keeps bytes in PostgreSQL. S3 is used when it is configured."""

import hashlib
import logging
from typing import Any, Protocol

import psycopg

from ai_workforce_api.settings import Settings

logger = logging.getLogger(__name__)


class StoreError(Exception):
    def __init__(self, detail: str) -> None:
        self.detail = detail


class ObjectStore(Protocol):
    def put(self, key: str, content: bytes) -> str: ...

    def get(self, key: str) -> bytes: ...


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
            config=Config(signature_version="s3v4", retries={"max_attempts": 2}),
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
        if found is not None:
            stored = self.get(key)
            if hashlib.sha256(stored).hexdigest() != digest:
                raise StoreError("stored object changed")
            return digest
        try:
            self._client.put_object(Bucket=self._bucket, Key=key, Body=content)
        except ClientError:
            logger.warning("object storage could not be written")
            raise StoreError("object storage is unavailable") from None
        return digest

    def get(self, key: str) -> bytes:
        from botocore.exceptions import ClientError

        try:
            response = self._client.get_object(Bucket=self._bucket, Key=key)
            body = response["Body"].read()
        except ClientError:
            logger.warning("object storage could not be read")
            raise StoreError("object storage is unavailable") from None
        if not isinstance(body, bytes):
            raise StoreError("stored object is missing")
        return body


def open_store(settings: Settings, connection: psycopg.Connection[Any]) -> ObjectStore:
    if settings.s3_configured():
        return S3ObjectStore(settings)
    return MockObjectStore(connection)


def digest_of(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()
