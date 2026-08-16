#!/bin/bash
set -e
cd /app/ComfyUI
extra_args=()
if [ "${COMFYUI_FORCE_CPU:-0}" = "1" ]; then
  echo "[comfyui] COMFYUI_FORCE_CPU=1 — генерация на CPU (медленно, но без CUDA sm_120)"
  extra_args+=(--cpu)
fi
# AstraChat открывает UI с другого origin (localhost:3000 → :8188). Без этого ComfyUI отвечает 403.
if [ "${COMFYUI_ENABLE_CORS_HEADER:-1}" = "1" ]; then
  cors_val="${COMFYUI_CORS_HEADER:-*}"
  echo "[comfyui] --enable-cors-header ${cors_val} (доступ из UI AstraChat / iframe)"
  extra_args+=(--enable-cors-header "${cors_val}")
fi
exec python main.py --listen 0.0.0.0 --port 8188 "${extra_args[@]}"
