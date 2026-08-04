const GLOBAL_WORKSPACE_KEY = 'astrachat_coding_default_workspace';

export function getGlobalDefaultWorkspace(): string {
  try {
    return localStorage.getItem(GLOBAL_WORKSPACE_KEY) || '';
  } catch {
    return '';
  }
}

export function setGlobalDefaultWorkspace(path: string): void {
  try {
    const text = (path || '').trim();
    if (!text) localStorage.removeItem(GLOBAL_WORKSPACE_KEY);
    else localStorage.setItem(GLOBAL_WORKSPACE_KEY, text);
    window.dispatchEvent(new CustomEvent('astrachatCodingWorkspaceChanged'));
  } catch {
    /* ignore */
  }
}

/** Проект → глобальный default → undefined (backend подставит default_workspace). */
export function resolveWorkspaceForChat(projectPath?: string | null): string | undefined {
  const fromProject = (projectPath || '').trim();
  if (fromProject) return fromProject;
  const global = getGlobalDefaultWorkspace().trim();
  return global || undefined;
}
