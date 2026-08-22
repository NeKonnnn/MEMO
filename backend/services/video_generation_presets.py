"""Пресеты моделей генерации видео (workflow + node_map)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from backend.settings import get_settings


def _cfg():
    return get_settings().video_generation


def _preset_row(pid: str, preset: Any) -> Dict[str, Any]:
    if hasattr(preset, "model_dump"):
        row = preset.model_dump()
    elif isinstance(preset, dict):
        row = dict(preset)
    else:
        return {}
    row["id"] = str(row.get("id") or pid)
    return row


def list_configured_presets() -> List[Dict[str, Any]]:
    cfg = _cfg()
    presets_map = getattr(cfg, "presets", None) or {}
    out: List[Dict[str, Any]] = []
    if isinstance(presets_map, dict):
        for pid, preset in presets_map.items():
            row = _preset_row(str(pid), preset)
            if row.get("label") or row.get("workflow_path"):
                out.append(row)
    return out


def resolve_preset(preset_id: Optional[str]) -> Optional[Dict[str, Any]]:
    cfg = _cfg()
    pid = (preset_id or "").strip()
    if not pid:
        pid = str(getattr(cfg, "default_preset_id", None) or "").strip()
    presets = list_configured_presets()
    if presets:
        if pid:
            for p in presets:
                if p.get("id") == pid:
                    return p
        return presets[0]
    wf = str(getattr(cfg, "workflow_path", None) or "").strip()
    if not wf:
        return None
    return {
        "id": "default",
        "label": "По умолчанию",
        "workflow_path": wf,
        "checkpoint_name": getattr(cfg, "checkpoint_name", "") or "",
        "default_width": int(getattr(cfg, "default_width", 512) or 512),
        "default_height": int(getattr(cfg, "default_height", 512) or 512),
        "default_steps": int(getattr(cfg, "default_steps", 20) or 20),
        "default_frames": int(getattr(cfg, "default_frames", 16) or 16),
        "node_map": getattr(cfg, "node_map", None) or {},
    }


def resolve_preset_node_map(preset: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    cfg = _cfg()
    if preset and isinstance(preset.get("node_map"), dict) and preset["node_map"]:
        return dict(preset["node_map"])
    nm = getattr(cfg, "node_map", None) or {}
    return dict(nm) if isinstance(nm, dict) else {}


def apply_preset_to_generation_params(
    preset: Optional[Dict[str, Any]],
    *,
    width: Optional[int] = None,
    height: Optional[int] = None,
    steps: Optional[int] = None,
    frames: Optional[int] = None,
) -> Dict[str, Any]:
    cfg = _cfg()
    p = preset or {}
    resolved_w = int(width if width is not None else p.get("default_width") or cfg.default_width)
    resolved_h = int(height if height is not None else p.get("default_height") or cfg.default_height)
    resolved_steps = int(steps if steps is not None else p.get("default_steps") or cfg.default_steps)
    resolved_frames = int(frames if frames is not None else p.get("default_frames") or cfg.default_frames)
    wf = str(p.get("workflow_path") or cfg.workflow_path or "").strip()
    return {
        "preset_id": str(p.get("id") or "default"),
        "preset_label": str(p.get("label") or "Видео"),
        "workflow_path": wf,
        "checkpoint_name": str(p.get("checkpoint_name") or cfg.checkpoint_name or "").strip(),
        "width": resolved_w,
        "height": resolved_h,
        "steps": resolved_steps,
        "frames": resolved_frames,
        "node_map": resolve_preset_node_map(preset),
    }
