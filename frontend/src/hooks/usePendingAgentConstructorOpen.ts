import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { resolvePendingAgentConstructorId } from '../utils/openAgentConstructorNav';

/** При переходе с галереи открывает правый сайдбар с конструктором агента. */
export function usePendingAgentConstructorOpen(
  openConstructorSidebar: () => void,
): void {
  const location = useLocation();
  const openRef = useRef(openConstructorSidebar);
  openRef.current = openConstructorSidebar;

  useEffect(() => {
    const agentId = resolvePendingAgentConstructorId(location.state);
    if (agentId != null) {
      openRef.current();
    }
  }, [location.pathname, location.state]);
}
