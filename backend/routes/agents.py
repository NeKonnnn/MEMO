"""
routes/agents.py — совместимость MCP status (оркестратор удалён).
Пользовательские агенты: /api/agents (api_agents.py).
"""

from datetime import datetime

from fastapi import APIRouter, HTTPException

from backend.settings.logging import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/agent", tags=["agents"])


@router.get("/mcp/status")
async def get_mcp_status():
    """Статус MCP-платформы (используется фронтом)."""
    try:
        from backend.mcp.platform import get_mcp_platform
        from backend.mcp.types import McpCallContext

        platform = get_mcp_platform()
        if not platform.initialized:
            return {
                "mcp_status": {
                    "initialized": False,
                    "servers_connected": 0,
                    "total_servers": 0,
                    "tools": 0,
                    "message": "MCP platform not initialized",
                },
                "success": True,
                "timestamp": datetime.now().isoformat(),
            }
        ctx = McpCallContext(user_id="system", username="system", is_admin=True)
        health = await platform.health(ctx)
        return {
            "mcp_status": {
                "initialized": health.get("initialized", False),
                "enabled": health.get("enabled", False),
                "servers_connected": health.get("servers_connected", 0),
                "total_servers": health.get("servers_total", 0),
                "tools": health.get("tools_total", 0),
                "servers": health.get("servers", []),
                "pool": health.get("pool", {}),
                "message": health.get("message"),
            },
            "success": True,
            "timestamp": datetime.now().isoformat(),
        }
    except Exception as e:
        logger.exception("Ошибка операции")
        raise HTTPException(status_code=500, detail=str(e)) from e
