import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { resolvePendingSkillSidebarId } from '../utils/openSkillSidebarNav';

/** При переходе с галереи открывает правый сайдбар с панелью Skills. */
export function usePendingSkillSidebarOpen(openSkillsSidebar: () => void): void {
  const location = useLocation();
  const openRef = useRef(openSkillsSidebar);
  openRef.current = openSkillsSidebar;

  useEffect(() => {
    const skillId = resolvePendingSkillSidebarId(location.state);
    if (skillId != null) {
      openRef.current();
    }
  }, [location.pathname, location.state]);
}
