# ComfyUI + ComfyUI-GGUF для стека astrachat (Qwen-Image и др. в models/unet).
# RTX 50xx (Blackwell, sm_120) требуют PyTorch 2.7+ и CUDA 12.8+.
# Сборка: docker compose build comfyui
FROM pytorch/pytorch:2.7.0-cuda12.8-cudnn9-runtime

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git ComfyUI

WORKDIR /app/ComfyUI
RUN pip install --no-cache-dir -r requirements.txt

# ComfyUI requirements может подтянуть torch без sm_120 — фиксируем cu128.
RUN pip install --no-cache-dir torch torchvision torchaudio \
    --index-url https://download.pytorch.org/whl/cu128

RUN git clone --depth 1 https://github.com/city96/ComfyUI-GGUF custom_nodes/ComfyUI-GGUF \
    && pip install --no-cache-dir -r custom_nodes/ComfyUI-GGUF/requirements.txt

# Triton (comfy_kitchen) при старте компилирует cuda_utils — нужен gcc.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

EXPOSE 8188

HEALTHCHECK --interval=20s --timeout=10s --start-period=300s --retries=15 \
    CMD curl -fsS http://127.0.0.1:8188/queue || exit 1

ENTRYPOINT ["/entrypoint.sh"]
