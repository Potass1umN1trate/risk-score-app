import asyncpg
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError

from app.api.analyze import router as analyze_router
from app.api.errors import _error
from app.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create a PostgreSQL connection pool on startup
    app.state.db_pool = await asyncpg.create_pool(
        dsn=settings.database_url,
        min_size=2,
        max_size=10,
    )
    yield
    # Close the pool on shutdown
    await app.state.db_pool.close()


app = FastAPI(
    title="Risk Score Analytics Service",
    version="1.0.0",
    lifespan=lifespan,
)

app.include_router(analyze_router, prefix="/api")


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return _error(422, "INVALID_REQUEST", "Invalid request body or parameters.")


@app.get("/health")
async def health():
    return {"status": "ok"}
