import { getApiUrl } from '../config/api';

export interface CodingAgentStatus {
  enabled: boolean;
  max_rounds: number;
  max_tool_calls: number;
  bash_timeout_sec: number;
  allowed_roots: string[];
  default_workspace?: string | null;
  tools: string[];
  plan_allowed_tools: string[];
  mutating_tools: string[];
}

export interface WorkspacePreset {
  id: string;
  label: string;
  path: string;
  host_hint?: string | null;
  ok: boolean;
  error?: string | null;
}

export interface CodingWorkspacesResponse {
  default_workspace?: string | null;
  presets: WorkspacePreset[];
  path_aliases: Record<string, string>;
}

export interface WorkspaceValidationResult {
  ok: boolean;
  path?: string | null;
  error?: string | null;
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function fetchCodingAgentStatus(): Promise<CodingAgentStatus> {
  const resp = await fetch(getApiUrl('/api/coding-agent/status'), { headers: authHeaders() });
  if (!resp.ok) throw new Error(`status ${resp.status}`);
  return resp.json();
}

export async function fetchCodingWorkspaces(): Promise<CodingWorkspacesResponse> {
  const resp = await fetch(getApiUrl('/api/coding-agent/workspaces'), { headers: authHeaders() });
  if (!resp.ok) throw new Error(`status ${resp.status}`);
  return resp.json();
}

export async function validateCodingWorkspace(path: string): Promise<WorkspaceValidationResult> {
  const resp = await fetch(getApiUrl('/api/coding-agent/validate-workspace'), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ path }),
  });
  if (!resp.ok) throw new Error(`status ${resp.status}`);
  return resp.json();
}
