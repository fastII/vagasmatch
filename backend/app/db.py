"""Persistência do pipeline do candidato (Postgres no compose, sqlite fora dele)."""
import time

from sqlalchemy import JSON, Column, DateTime, Integer, MetaData, String, Table, create_engine, delete, func, insert, select, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.exc import OperationalError

from . import config

engine = create_engine(config.DATABASE_URL, pool_pre_ping=True, future=True)
meta = MetaData()

# Uma linha por vaga no pipeline; o item inteiro (como o front o guarda) fica em `data`.
candidaturas = Table(
    "candidaturas",
    meta,
    Column("id", String(64), primary_key=True),
    Column("pos", Integer, nullable=False, default=0),
    Column("data", JSON().with_variant(JSONB, "postgresql"), nullable=False),
    Column("created_at", DateTime(timezone=True), server_default=func.now(), nullable=False),
    Column("updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False),
)


def init(retries: int = 30, wait: float = 1.0) -> None:
    """Cria as tabelas; espera o Postgres subir (o healthcheck do compose cobre o caso normal)."""
    for attempt in range(1, retries + 1):
        try:
            meta.create_all(engine)
            return
        except OperationalError:
            if attempt == retries:
                raise
            time.sleep(wait)


def ping() -> bool:
    try:
        with engine.connect() as conn:
            conn.execute(text("select 1"))
        return True
    except Exception:
        return False


def list_items() -> list[dict]:
    with engine.connect() as conn:
        rows = conn.execute(select(candidaturas.c.data).order_by(candidaturas.c.pos)).all()
    return [r[0] for r in rows]


def replace_all(items: list[dict]) -> int:
    """O front manda a lista inteira (é o mesmo contrato do localStorage); troca tudo numa transação."""
    with engine.begin() as conn:
        conn.execute(delete(candidaturas))
        if items:
            conn.execute(insert(candidaturas), [{"id": str(it["id"]), "pos": i, "data": it} for i, it in enumerate(items)])
    return len(items)
