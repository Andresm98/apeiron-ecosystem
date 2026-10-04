import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import replace

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from apeiron_api.container import Container, build_container
from apeiron_api.routes import auth, chat, memory, runs
from apeiron_api.settings import Settings
from apeiron_core.application.context import request_ctx


def create_app(settings: Settings | None = None) -> FastAPI:
    cfg = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        container: Container = await build_container(cfg)
        app.state.container = container
        yield
        await container.http.aclose()

    app = FastAPI(title="Ápeiron Ecosystem API", version="0.2.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cfg.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def trace_id_middleware(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        trace_id = request.headers.get("x-trace-id") or uuid.uuid4().hex
        request_ctx.set(replace(request_ctx.get(), trace_id=trace_id))
        response = await call_next(request)
        response.headers["X-Trace-Id"] = trace_id
        return response

    @app.get("/healthz", tags=["ops"])
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(auth.router)
    app.include_router(chat.router)
    app.include_router(memory.router)
    app.include_router(runs.router)
    return app
