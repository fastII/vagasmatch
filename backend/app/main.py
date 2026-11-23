"""VagaMatch API (FastAPI): /api/health, /api/analyze, /api/outreach, /api/pipeline.

Mesmo contrato do prototype/server.js, mais o pipeline persistido no banco.
Logs só com método, rota e status (uvicorn); nunca com currículo ou vaga.
"""
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import ai, config, db


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init()
    print(f"VagaMatch API (IA: {'ativa, ' + config.PROVIDER + ' · ' + config.MODEL + ' · effort ' + config.EFFORT if ai.client else 'inativa: ' + str(config.AI_ERROR)})", flush=True)
    yield


app = FastAPI(title="VagaMatch API", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)


@app.middleware("http")
async def limit_body(request: Request, call_next):
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > config.MAX_BODY:
        return JSONResponse({"error": "Corpo acima de 1 MB."}, status_code=413)
    return await call_next(request)


@app.exception_handler(Exception)
async def unhandled(_: Request, exc: Exception):
    status, msg = ai.api_error(exc)
    return JSONResponse({"error": msg}, status_code=status)


class AnalyzeIn(BaseModel):
    cv: str = ""
    job: str = ""
    resumo: dict[str, Any] | None = None
    opts: dict[str, Any] | None = None


class OutreachIn(AnalyzeIn):
    canal: str | None = None
    recrutador: str | None = None
    empresa: str | None = None
    tom: str | None = None


class PipelineItem(BaseModel):
    model_config = {"extra": "allow"}
    id: str = Field(min_length=1, max_length=64)


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "ai": ai.client is not None,
        "provider": config.PROVIDER,
        "model": config.MODEL,
        "effort": config.EFFORT,
        "aiError": config.AI_ERROR,
        "chaves": config.KEYS,
        "db": db.ping(),
    }


def _ai_guard():
    if ai.client is None:
        return JSONResponse({"error": "IA indisponível no servidor: " + str(config.AI_ERROR)}, status_code=503)
    return None


@app.post("/api/analyze")
def analyze(body: AnalyzeIn):
    if (r := _ai_guard()) is not None:
        return r
    try:
        return ai.analyze(body.model_dump())
    except Exception as e:  # erros do provedor viram JSON {error} com o status certo
        status, msg = ai.api_error(e)
        return JSONResponse({"error": msg}, status_code=status)


@app.post("/api/outreach")
def outreach(body: OutreachIn):
    if (r := _ai_guard()) is not None:
        return r
    try:
        return ai.outreach(body.model_dump())
    except Exception as e:
        status, msg = ai.api_error(e)
        return JSONResponse({"error": msg}, status_code=status)


@app.get("/api/pipeline")
def pipeline_list():
    return db.list_items()


@app.put("/api/pipeline")
def pipeline_replace(items: list[PipelineItem]):
    if len(items) > 5000:
        return JSONResponse({"error": "Pipeline acima de 5000 itens."}, status_code=413)
    n = db.replace_all([it.model_dump() for it in items])
    return {"ok": True, "count": n}
