"""Конфигурационный реестр HTTP-плагинов."""

from __future__ import annotations

from typing import Dict, List, Optional

from backend.settings.config import PluginConfig, PluginsPlatformConfig, Settings
from backend.settings.logging import get_logger

log = get_logger(__name__)


class PluginsRegistry:
    def __init__(self, settings: Settings):
        self._settings = settings
        self._config: PluginsPlatformConfig = settings.plugins
        self._plugins: Dict[str, PluginConfig] = {}

    def initialize(self) -> None:
        self._config = self._settings.plugins
        self._plugins = {}
        for plugin in self._config.catalog:
            if plugin.id:
                self._plugins[plugin.id] = plugin
        log.info(
            "Plugins registry loaded: enabled=%s plugins=%s",
            self._config.enabled,
            list(self._plugins.keys()),
        )

    @property
    def enabled(self) -> bool:
        return bool(self._config.enabled)

    @property
    def config(self) -> PluginsPlatformConfig:
        return self._config

    def list_plugins(self) -> List[PluginConfig]:
        return list(self._plugins.values())

    def list_enabled_plugins(self) -> List[PluginConfig]:
        return [p for p in self._plugins.values() if p.enabled]

    def get_plugin(self, plugin_id: str) -> Optional[PluginConfig]:
        return self._plugins.get(str(plugin_id or "").strip())

    def require_plugin(self, plugin_id: str) -> PluginConfig:
        plugin = self.get_plugin(plugin_id)
        if not plugin:
            raise KeyError(f"Plugin '{plugin_id}' not found")
        return plugin
