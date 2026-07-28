"""Валидация и резолв workspace для coding agent."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Union

from backend.settings.config import get_settings
from backend.utils.safe_paths import resolve_path_under_base


@dataclass
class WorkspaceValidation:
    ok: bool
    path: Optional[str] = None
    error: Optional[str] = None


def _allowed_roots() -> List[Path]:
    cfg = get_settings()
    coding = getattr(cfg, "coding_agent", None)
    roots_raw = list(getattr(coding, "allowed_roots", None) or []) if coding else []
    roots: List[Path] = []
    for raw in roots_raw:
        text = str(raw or "").strip()
        if not text:
            continue
        try:
            roots.append(Path(text).expanduser().resolve(strict=False))
        except (OSError, RuntimeError):
            continue
    return roots


def _is_under_any(path: Path, roots: Sequence[Path]) -> bool:
    for root in roots:
        try:
            path.relative_to(root)
            return True
        except ValueError:
            continue
    return False


def _apply_path_aliases(text: str) -> str:
    cfg = get_settings()
    coding = getattr(cfg, "coding_agent", None)
    aliases = dict(getattr(coding, "path_aliases", None) or {}) if coding else {}
    if not aliases:
        return text
    normalized = text.replace("\\", "/").rstrip("/")
    for host_raw, container in aliases.items():
        host_norm = str(host_raw or "").replace("\\", "/").rstrip("/")
        if host_norm and normalized.lower() == host_norm.lower():
            return str(container)
    return text


def validate_workspace(raw_path: Optional[str]) -> WorkspaceValidation:
    """Проверяет, что путь существует, это директория и (опционально) под allowlist."""
    text = _apply_path_aliases(str(raw_path or "").strip())
    if not text:
        return WorkspaceValidation(ok=False, error="Укажите абсолютный путь к workspace")

    candidate = Path(text).expanduser()
    if ".." in candidate.parts:
        return WorkspaceValidation(ok=False, error="Путь не должен содержать '..'")

    try:
        resolved = candidate.resolve(strict=False)
    except (OSError, RuntimeError) as exc:
        return WorkspaceValidation(ok=False, error=f"Некорректный путь: {exc}")

    if not resolved.is_absolute():
        return WorkspaceValidation(ok=False, error="Нужен абсолютный путь к папке")

    if not resolved.exists():
        return WorkspaceValidation(ok=False, error="Папка не существует")
    if not resolved.is_dir():
        return WorkspaceValidation(ok=False, error="Путь не является директорией")

    roots = _allowed_roots()
    if roots and not _is_under_any(resolved, roots):
        return WorkspaceValidation(
            ok=False,
            error="Workspace вне разрешённых корней (coding_agent.allowed_roots)",
        )

    return WorkspaceValidation(ok=True, path=str(resolved))


def list_workspace_presets() -> List[Dict[str, Any]]:
    """Пресеты из config с флагом ok (папка существует в backend/Docker)."""
    cfg = get_settings()
    coding = getattr(cfg, "coding_agent", None)
    raw_presets = list(getattr(coding, "workspace_presets", None) or []) if coding else []
    out: List[Dict[str, Any]] = []
    for item in raw_presets:
        if hasattr(item, "model_dump"):
            data = item.model_dump()
        elif isinstance(item, dict):
            data = dict(item)
        else:
            continue
        pid = str(data.get("id") or "").strip()
        label = str(data.get("label") or pid or "Workspace").strip()
        path = str(data.get("path") or "").strip()
        if not path:
            continue
        check = validate_workspace(path)
        out.append(
            {
                "id": pid or path.replace("/", "_"),
                "label": label,
                "path": check.path or path,
                "host_hint": data.get("host_hint"),
                "ok": check.ok,
                "error": check.error,
            }
        )
    return out


def resolve_workspace_path(raw_path: Optional[str]) -> Optional[str]:
    """Нормализует путь или возвращает default_workspace из конфига."""
    text = str(raw_path or "").strip()
    if text:
        result = validate_workspace(text)
        return result.path if result.ok else text
    cfg = get_settings()
    coding = getattr(cfg, "coding_agent", None)
    default = str(getattr(coding, "default_workspace", None) or "").strip() if coding else ""
    if default:
        result = validate_workspace(default)
        return result.path if result.ok else default
    presets = list_workspace_presets()
    for preset in presets:
        if preset.get("ok") and preset.get("path"):
            return str(preset["path"])
    return None


def resolve_under_workspace(
    workspace: Union[str, Path],
    raw_path: Optional[str],
    *,
    must_exist: bool = False,
) -> Path:
    """
    Резолвит путь относительно workspace.
    Абсолютные пути допускаются только если они внутри workspace.
    """
    ws = Path(workspace).resolve(strict=False)
    text = str(raw_path or "").strip() or "."
    if text in (".", "./"):
        return ws

    candidate = Path(text).expanduser()
    if any(part == ".." for part in candidate.parts):
        raise ValueError("Путь не должен содержать '..'")

    if candidate.is_absolute():
        resolved = resolve_path_under_base(candidate, ws)
        if resolved is None:
            raise ValueError("Путь вне workspace")
    else:
        # relative: resolve_path_under_base запрещает ".." уже проверено
        resolved = (ws / candidate).resolve(strict=False)
        try:
            resolved.relative_to(ws)
        except ValueError as exc:
            raise ValueError("Путь вне workspace") from exc

    if must_exist and not resolved.exists():
        raise ValueError(f"Не найдено: {resolved}")
    return resolved


def skip_dir_names() -> frozenset:
    return frozenset(
        {
            ".git",
            ".hg",
            ".svn",
            "node_modules",
            "venv",
            ".venv",
            "__pycache__",
            ".mypy_cache",
            ".pytest_cache",
            ".ruff_cache",
            "dist",
            "build",
            ".next",
            ".cache",
            "site-packages",
            ".idea",
            ".tox",
        }
    )


def env_with_workspace(workspace: str) -> dict:
    env = os.environ.copy()
    env["PWD"] = workspace
    return env
