/** Типы каталога HTTP-плагинов. */

export interface PluginPublic {
  id: string;
  display_name: string;
  description?: string;
  enabled: boolean;
  kind?: string;
  category?: string;
  tags?: string[];
  health_path?: string;
  invoke_path?: string;
  healthy?: boolean | null;
  health_detail?: Record<string, unknown> | null;
}

export interface PluginInvokeResult {
  success: boolean;
  plugin_id: string;
  /** Готовый markdown для UI (собирается на backend для cash-flow). */
  markdown?: string;
  result: {
    status?: string;
    request_id?: string;
    file?: string;
    verdict_markdown?: string | null;
    steps?: Record<string, boolean>;
    deterministic_findings?: Array<{
      where?: string;
      type?: string;
      n?: string;
      detail?: string;
    }>;
    message?: string;
    [key: string]: unknown;
  };
}
