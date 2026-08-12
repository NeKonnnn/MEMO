import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ArtifactPanelTab, ChatArtifact } from '../types/artifacts';

interface ArtifactContextValue {
  current: ChatArtifact | null;
  isOpen: boolean;
  tab: ArtifactPanelTab;
  openArtifact: (artifact: ChatArtifact, opts?: { tab?: ArtifactPanelTab }) => void;
  updateArtifact: (artifact: ChatArtifact) => void;
  closeArtifact: () => void;
  setTab: (tab: ArtifactPanelTab) => void;
}

const ArtifactContext = createContext<ArtifactContextValue | null>(null);

/** Убирает SVG ошибок Mermaid, которые библиотека могла воткнуть прямо в body. */
function scrubOrphanMermaidErrors() {
  document.querySelectorAll('body > svg').forEach((svg) => {
    const text = (svg.textContent || '').toLowerCase();
    if (text.includes('error in text') || text.includes('syntax error')) {
      svg.remove();
    }
  });
}

export function ArtifactProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<ChatArtifact | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<ArtifactPanelTab>('preview');

  useEffect(() => {
    scrubOrphanMermaidErrors();
  }, []);

  const openArtifact = useCallback((artifact: ChatArtifact, opts?: { tab?: ArtifactPanelTab }) => {
    setCurrent(artifact);
    setIsOpen(true);
    setTab(opts?.tab || (artifact.closed ? 'preview' : 'code'));
  }, []);

  const updateArtifact = useCallback((artifact: ChatArtifact) => {
    setCurrent((prev) => {
      if (!prev || prev.id !== artifact.id) return prev;
      if (prev.content === artifact.content && prev.closed === artifact.closed) return prev;
      return artifact;
    });
  }, []);

  const closeArtifact = useCallback(() => {
    setIsOpen(false);
  }, []);

  const value = useMemo(
    () => ({
      current,
      isOpen,
      tab,
      openArtifact,
      updateArtifact,
      closeArtifact,
      setTab,
    }),
    [current, isOpen, tab, openArtifact, updateArtifact, closeArtifact],
  );

  return <ArtifactContext.Provider value={value}>{children}</ArtifactContext.Provider>;
}

export function useArtifactContext(): ArtifactContextValue {
  const ctx = useContext(ArtifactContext);
  if (!ctx) {
    throw new Error('useArtifactContext must be used within ArtifactProvider');
  }
  return ctx;
}

export function useOptionalArtifactContext(): ArtifactContextValue | null {
  return useContext(ArtifactContext);
}
