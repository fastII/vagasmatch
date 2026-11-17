"""Configuração lida do ambiente. O .env da raiz entra via docker compose (env_file) ou --env-file."""
import os
import re

DEFAULT_MODEL = {"anthropic": "claude-opus-5-5", "openai": "gpt-5"}
DEFAULT_EFFORT = {"anthropic": "high", "openai": "medium"}
MAX_OUTPUT_TOKENS = 16000
MAX_BODY = 1_000_000  # 1 MB por requisição

_PLACEHOLDER = re.compile(r"your|xxx|placeholder|changeme", re.I)


def looks_like_key(v: str | None) -> bool:
    return bool(v) and len(v) >= 30 and not _PLACEHOLDER.search(v)


KEYS = {
    "anthropic": looks_like_key(os.environ.get("ANTHROPIC_API_KEY")),
    "openai": looks_like_key(os.environ.get("OPENAI_API_KEY")),
}


def pick_provider() -> str:
    forced = (os.environ.get("VAGAMATCH_PROVIDER") or "").strip().lower()
    if forced:
        if forced not in DEFAULT_MODEL:
            raise ValueError(f'VAGAMATCH_PROVIDER inválido: "{forced}" (use anthropic ou openai)')
        if not KEYS[forced]:
            raise ValueError(f"VAGAMATCH_PROVIDER={forced}, mas a chave desse provedor não está no .env")
        return forced
    if KEYS["anthropic"]:
        return "anthropic"
    if KEYS["openai"]:
        return "openai"
    raise ValueError("sem chave: defina OPENAI_API_KEY ou ANTHROPIC_API_KEY no .env")


PROVIDER: str | None = None
MODEL: str | None = None
EFFORT: str | None = None
AI_ERROR: str | None = None
try:
    PROVIDER = pick_provider()
    MODEL = os.environ.get("VAGAMATCH_MODEL") or DEFAULT_MODEL[PROVIDER]
    EFFORT = os.environ.get("VAGAMATCH_EFFORT") or DEFAULT_EFFORT[PROVIDER]
except ValueError as e:
    AI_ERROR = str(e)

# Postgres no compose; sqlite quando rodar o backend solto na máquina.
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./vagamatch.db")
