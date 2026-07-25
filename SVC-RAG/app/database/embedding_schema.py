"""Схема pgvector для нескольких embedding-моделей одновременно.

Ключевая идея: у каждой размерности — СВОЯ таблица векторов, и они СОСУЩЕСТВУЮТ.
Историческая таблица (kb_vectors и т.п.) остаётся таблицей своей текущей размерности,
остальные получают суффикс: kb_vectors_2048. Существующие данные не переносятся и
не удаляются.

Что НЕЛЬЗЯ делать (и почему тут этого нет по умолчанию): приводить одну общую таблицу
к новой размерности через ALTER — это требует TRUNCATE, то есть стирает вектора ВСЕХ
пользователей из-за выбора одного. Старая функция migrate_vector_tables оставлена, но
только для явного админского вызова.

Типы по размерности (pgvector 0.8):
  dim <= 2000   -> vector(dim)  + HNSW (vector_cosine_ops)
  2001..4000    -> halfvec(dim) + HNSW (halfvec_cosine_ops)
  dim > 4000    -> vector(dim), без ANN (точный скан)
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# https://github.com/pgvector/pgvector#hnsw
HNSW_MAX_DIM = 2000  # предел для типа vector
HALFVEC_MAX_DIM = 4000  # предел для типа halfvec (нужен pgvector >= 0.7)

VECTOR_TABLES: Tuple[str, ...] = (
    "kb_vectors",
    "memory_rag_vectors",
    "project_rag_vectors",
)

_INDEX_BY_TABLE = {
    "kb_vectors": "idx_kb_vectors_embedding_hnsw",
    "memory_rag_vectors": "idx_memory_rag_vectors_embedding_hnsw",
    "project_rag_vectors": "idx_proj_rag_vectors_embedding_hnsw",
}

def index_name_for(table: str) -> str:
    """Имя HNSW-индекса. Для таблиц с суффиксом размерности — производное."""
    known = _INDEX_BY_TABLE.get(table)
    if known:
        return known
    return f"idx_{table}_embedding_hnsw"

def vector_column_type(dim: int) -> str:
    """Тип колонки embedding для этой размерности."""
    d = int(dim)
    if HNSW_MAX_DIM < d <= HALFVEC_MAX_DIM:
        return f"halfvec({d})"
    return f"vector({d})"

def vector_cast(dim: int) -> str:
    """Во что кастовать литерал вектора в запросах для этой размерности."""
    d = int(dim)
    if HNSW_MAX_DIM < d <= HALFVEC_MAX_DIM:
        return "halfvec"
    return "vector"

async def get_column_embedding_type(conn, table: str) -> Optional[Tuple[int, str]]:
    """(dim, 'vector'|'halfvec') колонки embedding или None, если таблицы нет."""
    row = await conn.fetchrow(
        """
        SELECT format_type(a.atttypid, a.atttypmod) AS ft
        FROM pg_attribute a
        JOIN pg_class c ON a.attrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE n.nspname = 'public'
          AND c.relname = $1
          AND a.attname = 'embedding'
          AND NOT a.attisdropped
        """,
        table,
    )
    if not row or not row["ft"]:
        return None
    ft = str(row["ft"]).lower()
    m = re.search(r"(halfvec|vector)\((\d+)\)", ft)
    if not m:
        return None
    return int(m.group(2)), m.group(1)


async def get_column_vector_dim(conn, table: str) -> Optional[int]:
    """Текущая размерность колонки embedding или None, если таблицы нет."""
    info = await get_column_embedding_type(conn, table)
    return info[0] if info else None

async def table_exists(conn, table: str) -> bool:
    return bool(
        await conn.fetchval("SELECT to_regclass($1) IS NOT NULL", f"public.{table}")
    )

async def resolve_vector_table(conn, base: str, dim: int) -> str:
    """Имя таблицы векторов для размерности dim.

    Историческая таблица без суффикса обслуживает СВОЮ размерность (её данные не трогаем).
    Если базовой таблицы ещё нет — она и станет таблицей этой размерности.
    Остальные размерности живут в base_<dim>.
    """
    d = int(dim)
    legacy_dim = await get_column_vector_dim(conn, base)
    if legacy_dim is None:
        return base
    if int(legacy_dim) == d:
        return base
    return f"{base}_{d}"

async def drop_embedding_index(conn, table: str) -> None:
    await conn.execute(f"DROP INDEX IF EXISTS {index_name_for(table)}")

async def create_embedding_index(conn, table: str, dim: int) -> bool:
    """HNSW под фактический тип колонки. Возвращает True, если индекс есть.

    Размерность и тип (vector/halfvec) берём из БД — колонка могла разойтись с конфигом.
    Legacy-таблицы часто ``vector(2048+)``: для них HNSW недоступен (лимит vector=2000),
    halfvec_ops на vector ставить нельзя.
    """
    index_name = index_name_for(table)
    info = await get_column_embedding_type(conn, table)
    if info:
        effective_dim, col_kind = info
    else:
        effective_dim, col_kind = int(dim or 0), (
            "halfvec" if int(dim or 0) > HNSW_MAX_DIM else "vector"
        )
    if effective_dim < 1:
        return False

    if effective_dim > HALFVEC_MAX_DIM:
        logger.warning(
            "%s: dim=%s > %s — ANN-индекс не создаём, поиск точным сканом",
            table,
            effective_dim,
            HALFVEC_MAX_DIM,
        )
        await conn.execute(f"DROP INDEX IF EXISTS {index_name}")
        return False

    # HNSW для vector только до 2000; для halfvec — до 4000.
    if col_kind == "vector" and effective_dim > HNSW_MAX_DIM:
        logger.warning(
            "%s: колонка vector(%s) > %s — HNSW недоступен (нужен halfvec), работаем без ANN",
            table,
            effective_dim,
            HNSW_MAX_DIM,
        )
        await conn.execute(f"DROP INDEX IF EXISTS {index_name}")
        return False

    ops = "halfvec_cosine_ops" if col_kind == "halfvec" else "vector_cosine_ops"
    try:
        await conn.execute(
            f"""
            CREATE INDEX IF NOT EXISTS {index_name}
            ON {table} USING hnsw (embedding {ops})
            """
        )
        return True
    except Exception:
        logger.exception(
            "%s: не удалось создать HNSW (dim=%s, kind=%s, ops=%s) — работаем без ANN",
            table,
            effective_dim,
            col_kind,
            ops,
        )
        return False

async def ensure_vector_table(conn, base: str, dim: int, parent_table: str) -> str:
    """Гарантировать таблицу векторов для размерности dim. ДОБАВЛЯЮЩАЯ операция.

    Ничего не удаляет, не очищает и не конвертирует. Возвращает имя таблицы.
    """
    d = int(dim)
    if d < 1:
        raise ValueError(f"Некорректная embedding_dim: {dim}")
    table = await resolve_vector_table(conn, base, d)
    coltype = vector_column_type(d)
    await conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
    await conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {table} (
            id SERIAL PRIMARY KEY,
            document_id INTEGER NOT NULL REFERENCES {parent_table}(id) ON DELETE CASCADE,
            chunk_index INTEGER NOT NULL,
            embedding {coltype} NOT NULL,
            content TEXT NOT NULL,
            metadata JSONB DEFAULT '{{}}'::jsonb,
            created_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(document_id, chunk_index)
        )
        """
    )
    await conn.execute(
        f"CREATE INDEX IF NOT EXISTS idx_{table}_document_id ON {table}(document_id)"
    )
    await create_embedding_index(conn, table, d)
    logger.info("Таблица векторов %s готова (dim=%s, тип=%s)", table, d, coltype)
    return table

async def list_vector_tables(conn, base: str) -> List[str]:
    """Все существующие таблицы этого стора: base и base_<dim>.

    Нужно операциям «по документу» (удаление, перечисление): у одного документа могут
    быть вектора сразу в нескольких таблицах — по одной на модель.
    """
    rows = await conn.fetch(
        """
        SELECT c.relname AS name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND (c.relname = $1 OR c.relname ~ ('^' || $1 || '_[0-9]+$'))
        ORDER BY c.relname
        """,
        base,
    )
    return [r["name"] for r in rows]

async def vector_tables_overview(conn) -> Dict[str, Any]:
    """Диагностика: какие таблицы векторов есть, какой размерности и сколько строк."""
    out: Dict[str, Any] = {}
    for base in VECTOR_TABLES:
        tables = []
        for name in await list_vector_tables(conn, base):
            try:
                dim = await get_column_vector_dim(conn, name)
                count = int(await conn.fetchval(f"SELECT COUNT(*) FROM {name}") or 0)
            except Exception:
                dim, count = None, -1
            tables.append({"table": name, "dim": dim, "rows": count})
        out[base] = tables
    return out

async def migrate_vector_tables(conn, target_dim: int) -> Dict[str, Any]:
    """РАЗРУШИТЕЛЬНО. Приводит общие таблицы к target_dim, ОЧИЩАЯ их (TRUNCATE).

    Стирает вектора ВСЕХ пользователей. Оставлено только для явного админского
    сценария (например, осознанный сброс корпуса). В обычном потоке смены модели
    НЕ вызывать — используйте ensure_vector_table: она добавляет таблицу нужной
    размерности рядом, ничего не удаляя.
    """
    if target_dim < 1:
        raise ValueError(f"Некорректная embedding_dim: {target_dim}")

    logger.warning(
        "migrate_vector_tables(dim=%s): РАЗРУШИТЕЛЬНАЯ операция, таблицы будут очищены",
        target_dim,
    )

    changed: List[str] = []
    unchanged: List[str] = []
    cleared_rows = 0
    hnsw_enabled = target_dim <= HALFVEC_MAX_DIM

    for table in VECTOR_TABLES:
        if not await table_exists(conn, table):
            continue

        current = await get_column_vector_dim(conn, table)
        if current == target_dim:
            await drop_embedding_index(conn, table)
            await create_embedding_index(conn, table, target_dim)
            unchanged.append(table)
            continue

        count = int(await conn.fetchval(f"SELECT COUNT(*) FROM {table}") or 0)
        await drop_embedding_index(conn, table)
        if count > 0:
            await conn.execute(f"TRUNCATE TABLE {table}")
            cleared_rows += count
        await conn.execute(
            f"ALTER TABLE {table} ALTER COLUMN embedding TYPE {vector_column_type(target_dim)}"
        )
        await create_embedding_index(conn, table, target_dim)
        changed.append(table)
        logger.warning(
            "Миграция %s: dim %s → %s, ОЧИЩЕНО строк=%s",
            table,
            current,
            target_dim,
            count,
        )

    return {
        "embedding_dim": target_dim,
        "changed_tables": changed,
        "unchanged_tables": unchanged,
        "cleared_rows": cleared_rows,
        "migrated": bool(changed),
        "hnsw_enabled": hnsw_enabled,
        "hnsw_max_dim": HNSW_MAX_DIM,
        "halfvec_max_dim": HALFVEC_MAX_DIM,
    }