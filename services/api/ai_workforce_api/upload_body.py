"""An uploaded file's body, read with a hard limit (reliability and security audit,
17 November 2026).

Every upload route read the whole body (`await request.body()`) before it looked at the
size, so a body of any size was held in memory first, and the route then did its database,
storage and reading work on the event loop. Now the declared length is checked before
anything is read, and the body is read in pieces that stop one byte past the route's limit:
nothing larger than the limit is ever held. The routes run their work off the event loop
(starlette's thread pool), so one upload being read or stored never stalls the others.
"""

from fastapi import HTTPException, Request

# Over the route's limit: the request is refused as too large, before or while reading.
TOO_LARGE = 413


async def read_body(request: Request, limit: int, too_large: str) -> bytes:
    """The request's body, at most `limit` bytes. A declared Content-Length over the limit
    is refused before a byte is read; a body that turns out longer than the limit (no
    declared length, or a false one) is refused as soon as it passes it. `too_large` is the
    route's own words for the refusal."""
    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            length = int(declared)
        except ValueError:
            raise HTTPException(status_code=400, detail="the request length is invalid") from None
        if length < 0:
            raise HTTPException(status_code=400, detail="the request length is invalid")
        if length > limit:
            raise HTTPException(status_code=TOO_LARGE, detail=too_large)
    pieces: list[bytes] = []
    size = 0
    async for piece in request.stream():
        size += len(piece)
        if size > limit:
            raise HTTPException(status_code=TOO_LARGE, detail=too_large)
        pieces.append(piece)
    return b"".join(pieces)
