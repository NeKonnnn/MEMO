"""
Генерация видео через ComfyUI: конфиг, режим чата, вызов workflow.
"""

from __future__ import annotations

import copy
import os
import random
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx

from backend.services.comfyui_image_generation import (
    ComfyImageGenError,
    apply_checkpoint_to_workflow,
    bytes_to_data_uri,
    fetch_comfyui_checkpoint_names,
    generate_videos_via_comfyui,
    inject_workflow_inputs,
    load_workflow_template,
    resolve_workflow_file,
)
from backend.services.image_generation_service import (
    metadata_for_mongodb_storage,
    save_image_generation_assistant_message,
)
from backend.services.video_generation_presets import (
    apply_preset_to_generation_params,
    resolve_preset,
)
from backend.settings.logging import get_logger

logger = get_logger(__name__)


def _workflow_base_dir() -> Path:
    routes_dir = Path(__file__).resolve().parent.parent / "routes"
    backend_dir = routes_dir.parent
    if (backend_dir / "config").is_dir():
        return backend_dir
    return backend_dir.parent


def _node_map_plain(node_map: Any) -> Dict[str, Tuple[str, str]]:
    out: Dict[str, Tuple[str, str]] = {}
    if not node_map:
        return out
    for key, val in node_map.items():
        if isinstance(val, dict):
            node_id = val.get("node")
            field = val.get("input")
        else:
            node_id = getattr(val, "node", None)
            field = getattr(val, "input", None)
        if node_id is not None and field is not None:
            out[str(key)] = (str(node_id), str(field))
    return out


def get_video_generation_settings():
    from backend.settings import get_settings

    return get_settings().video_generation


def is_video_generation_configured() -> bool:
    try:
        cfg = get_video_generation_settings()
        if not cfg or not cfg.enabled:
            return False
        wf = str(cfg.workflow_path or "").strip()
        presets = getattr(cfg, "presets", None) or {}
        if wf:
            return True
        if isinstance(presets, dict) and presets:
            return True
        return bool(resolve_preset(None))
    except Exception:
        return False


def resolve_video_prompt_from_chat(message: str, *, mode_enabled: bool = False) -> Optional[str]:
    text = (message or "").strip()
    if not text:
        return None
    if mode_enabled:
        return text
    return None


def is_video_generation_chat_request(message: str, *, mode_enabled: bool = False) -> bool:
    cfg = get_video_generation_settings()
    if not cfg or not cfg.enabled:
        return False
    if mode_enabled:
        return bool((message or "").strip())
    if not cfg.chat_triggers_enabled:
        return False
    return resolve_video_prompt_from_chat(message, mode_enabled=False) is not None


def _resolve_comfyui_url(cfg) -> str:
    env_url = (os.getenv("VIDEO_GEN_COMFYUI_URL") or "").strip().rstrip("/")
    if env_url:
        return env_url
    env_img = (os.getenv("IMAGE_GEN_COMFYUI_URL") or "").strip().rstrip("/")
    if env_img:
        return env_img
    return (cfg.comfyui_base_url or "").strip().rstrip("/")


def _ext_for_mime(mime: str) -> str:
    m = (mime or "").lower()
    if "webm" in m:
        return ".webm"
    if "gif" in m:
        return ".gif"
    if "quicktime" in m or "mov" in m:
        return ".mov"
    return ".mp4"


def build_generated_video_attachments(
    pairs: List[Tuple[bytes, str]],
    *,
    prompt: str,
) -> Tuple[str, Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for idx, (data, mime) in enumerate(pairs, 1):
        ext = _ext_for_mime(mime)
        data_uri = bytes_to_data_uri(data, mime)
        items.append(
            {
                "name": f"generated_video_{idx}{ext}",
                "contentType": "video",
                "data_uri": data_uri,
                "generated": True,
                "prompt": prompt[:500],
            }
        )

    if not items:
        return "Не удалось получить видео от ComfyUI.", {}

    text = f"Готово! Сгенерировал видео по запросу: «{prompt}»"
    meta = {"inline_attachments": items, "video_generation": True}
    return text, meta


async def try_upload_generated_videos_to_minio(
    pairs: List[Tuple[bytes, str]],
    *,
    prompt: str,
) -> List[Dict[str, Any]]:
    from backend.app_state import minio_client

    _text, meta = build_generated_video_attachments(pairs, prompt=prompt)
    attachments = list(meta.get("inline_attachments") or [])
    if not minio_client or not attachments:
        return attachments

    bucket = os.getenv("MINIO_DOCUMENTS_BUCKET_NAME", "astrachat-documents")
    for idx, (data, mime) in enumerate(pairs):
        if idx >= len(attachments):
            break
        ext = _ext_for_mime(mime)
        object_name = minio_client.generate_object_name(prefix="gen_vid_", extension=ext)
        try:
            minio_client.upload_file(data, object_name, content_type=mime, bucket_name=bucket)
            attachments[idx]["minio_object"] = object_name
            attachments[idx]["minio_bucket"] = bucket
        except Exception as exc:
            logger.warning("MinIO upload for generated video failed: %s", exc)
    return attachments


async def generate_videos(
    *,
    prompt: str,
    width: Optional[int] = None,
    height: Optional[int] = None,
    steps: Optional[int] = None,
    frames: Optional[int] = None,
    seed: Optional[int] = None,
    preset_id: Optional[str] = None,
    negative_prompt: Optional[str] = None,
    cfg: Optional[float] = None,
) -> List[Tuple[bytes, str]]:
    cfg_settings = get_video_generation_settings()
    if not cfg_settings or not cfg_settings.enabled:
        raise ComfyImageGenError("Генерация видео отключена (video_generation.enabled)")

    preset = resolve_preset(preset_id)
    gen = apply_preset_to_generation_params(preset, width=width, height=height, steps=steps, frames=frames)

    url = _resolve_comfyui_url(cfg_settings)
    wf_rel = (gen.get("workflow_path") or "").strip()
    node_map = _node_map_plain(gen.get("node_map") or cfg_settings.node_map)
    if not url or not wf_rel:
        raise ComfyImageGenError(
            "Задайте video_generation.workflow_path и node_map в config.yml (ComfyUI workflow API JSON)"
        )
    if not node_map:
        raise ComfyImageGenError("Задайте video_generation.node_map или node_map в пресете видео")

    wf_path = resolve_workflow_file(wf_rel, _workflow_base_dir())
    workflow = copy.deepcopy(load_workflow_template(wf_path))

    inject: Dict[str, Any] = {"prompt": prompt.strip()}
    width = int(gen["width"])
    height = int(gen["height"])
    steps = int(gen["steps"])
    frames = int(gen["frames"])
    if seed is None:
        seed = random.randint(0, 2**31 - 1)

    inject["width"] = width
    inject["height"] = height
    inject["steps"] = steps
    inject["seed"] = seed
    inject["frames"] = frames
    if negative_prompt is not None and str(negative_prompt).strip():
        inject["negative_prompt"] = str(negative_prompt).strip()
    if cfg is not None:
        inject["cfg"] = float(cfg)

    inject_workflow_inputs(workflow, node_map, inject)

    ckpt_pref = str(gen.get("checkpoint_name") or getattr(cfg_settings, "checkpoint_name", None) or "").strip()
    ckpt_node = node_map.get("checkpoint")
    if ckpt_node and not ckpt_pref:
        node_id, field = ckpt_node
        node = workflow.get(str(node_id))
        if isinstance(node, dict):
            inputs = node.get("inputs") or {}
            if field in inputs:
                ckpt_pref = str(inputs[field] or "").strip()

    try:
        available_ckpts = await fetch_comfyui_checkpoint_names(url)
        chosen_ckpt = apply_checkpoint_to_workflow(
            workflow,
            available_ckpts,
            preferred=ckpt_pref,
            strict_preferred=bool(ckpt_pref),
        )
    except httpx.HTTPError as exc:
        raise ComfyImageGenError(f"Не удалось получить список моделей ComfyUI: {exc}") from exc

    logger.info(
        "ComfyUI video gen: preset=%s workflow=%s checkpoint=%s size=%sx%s steps=%s frames=%s",
        gen.get("preset_id"),
        wf_rel,
        chosen_ckpt,
        width,
        height,
        steps,
        frames,
    )

    return await generate_videos_via_comfyui(
        comfyui_base_url=url,
        workflow=workflow,
        timeout_sec=float(cfg_settings.request_timeout_sec),
        poll_interval_sec=float(cfg_settings.poll_interval_sec),
    )


async def handle_chat_video_generation(
    user_message: str,
    *,
    preset_id: Optional[str] = None,
    mode_enabled: bool = False,
) -> Dict[str, Any]:
    prompt = resolve_video_prompt_from_chat(user_message, mode_enabled=mode_enabled)
    if not prompt:
        raise ComfyImageGenError("Не удалось извлечь промпт из сообщения")

    if not is_video_generation_configured():
        raise ComfyImageGenError(
            "Генерация видео не настроена: включите video_generation.enabled, "
            "укажите workflow_path, node_map и запустите ComfyUI с video workflow"
        )

    effective_preset = resolve_preset(preset_id)
    gen_plan = apply_preset_to_generation_params(effective_preset, width=None, height=None, steps=None)

    pairs = await generate_videos(prompt=prompt, preset_id=preset_id or gen_plan.get("preset_id"))
    attachments = await try_upload_generated_videos_to_minio(pairs, prompt=prompt)
    text, meta = build_generated_video_attachments(pairs, prompt=prompt)
    if attachments:
        meta = {"inline_attachments": attachments, "video_generation": True}
    if effective_preset:
        meta = dict(meta)
        meta["video_gen_preset_id"] = effective_preset.get("id")
        meta["video_gen_preset_label"] = effective_preset.get("label")
        meta["video_gen_workflow_path"] = gen_plan.get("workflow_path")
    return {
        "response": text,
        "metadata": meta,
        "inline_attachments": meta.get("inline_attachments") or [],
    }


async def save_video_generation_assistant_message(
    *,
    content: str,
    metadata: Dict[str, Any],
    conversation_id: Optional[str],
    project_id: Optional[str],
    user_id: Optional[str],
    regenerate: bool = False,
    assistant_message_id: Optional[str] = None,
) -> bool:
    stored_meta = metadata_for_mongodb_storage(metadata)
    return await save_image_generation_assistant_message(
        content=content,
        metadata=stored_meta,
        conversation_id=conversation_id,
        project_id=project_id,
        user_id=user_id,
        regenerate=regenerate,
        assistant_message_id=assistant_message_id,
    )
