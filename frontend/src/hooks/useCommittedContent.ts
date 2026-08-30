import { useEffect, useState } from 'react';

/**
 * Во время стрима отдаёт content с debounce; по завершении — сразу.
 * Снижает thrashing iframe/Sandpack/Mermaid на каждый токен.
 */
export function useCommittedContent(
  content: string,
  isStreaming: boolean,
  delayMs = 450,
): string {
  const [committed, setCommitted] = useState(content);

  useEffect(() => {
    if (!isStreaming) {
      setCommitted(content);
      return;
    }
    const timer = window.setTimeout(() => setCommitted(content), delayMs);
    return () => window.clearTimeout(timer);
  }, [content, isStreaming, delayMs]);

  return committed;
}
