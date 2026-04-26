from pydantic import BaseModel
from fastapi.responses import JSONResponse


class ErrorResponse(BaseModel):
    error_code: str
    detail: str
    request_id: str | None = None


def _error(status: int, code: str, detail: str, request_id: str | None = None) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content=ErrorResponse(
            error_code=code,
            detail=detail,
            request_id=request_id,
        ).model_dump(),
    )
