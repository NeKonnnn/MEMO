import React, { startTransition, useCallback, useEffect, useState } from 'react';
import {
  Box,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
} from '@mui/material';
import {
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  HistoryEdu as SkillsNavIcon,
} from '@mui/icons-material';
import {
  SIDEBAR_CHAT_ROW_LIST_ITEM_BUTTON_SX,
  SIDEBAR_HIDE_SCROLLBAR_SX,
  SIDEBAR_LIST_ICON_SX,
  SIDEBAR_LIST_ICON_TO_TEXT_GAP_PX,
  getSidebarRailCollapsedListItemButtonSx,
} from '../../constants/menuStyles';
import {
  getSidebarChromeSx,
  getSidebarForcedContrastSx,
  getSidebarPanelBackground,
  isSidebarPanelLight,
} from '../../constants/sidebarPanelColor';
import {
  SidebarRailAgentIcon,
  SidebarRailTranscribeIcon,
} from '../../constants/sidebarRailIcons';
import {
  ASTRA_OPEN_AGENT_CONSTRUCTOR,
  ASTRA_OPEN_SKILLS_SIDEBAR,
  ASTRA_OPEN_TRANSCRIPTION_SIDEBAR,
} from '../../constants/hotkeys';
import { usePendingAgentConstructorOpen } from '../../hooks/usePendingAgentConstructorOpen';
import { usePendingSkillSidebarOpen } from '../../hooks/usePendingSkillSidebarOpen';
import AgentConstructorPanel from './AgentConstructorPanel';
import GalleryNavButton from './GalleryNavButton';
import SkillsSidebarPanel from './SkillsSidebarPanel';
import SidebarRailMenuGlyph from '../SidebarRailMenuGlyph';
import TranscriptionSidebarSection from './TranscriptionSidebarSection';

export interface RightBarProps {
  open: boolean;
  hidden: boolean;
  isDarkMode: boolean;
  onToggleOpen: () => void;
  onHide: () => void;
  onShow: () => void;
  setOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  setHidden: (hidden: boolean | ((prev: boolean) => boolean)) => void;
}

export default function RightBar({
  open,
  hidden,
  isDarkMode,
  onToggleOpen,
  onHide,
  onShow,
  setOpen,
  setHidden,
}: RightBarProps) {
  const [panelBg, setPanelBg] = useState(() => getSidebarPanelBackground());
  const [transcriptionMenuOpen, setTranscriptionMenuOpen] = useState(false);
  const [skillsPanelOpen, setSkillsPanelOpen] = useState(false);
  const [agentConstructorOpen, setAgentConstructorOpen] = useState(false);

  useEffect(() => {
    const sync = () => setPanelBg(getSidebarPanelBackground());
    window.addEventListener('sidebarColorChanged', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('sidebarColorChanged', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const openConstructorSidebar = useCallback(() => {
    startTransition(() => {
      setHidden(false);
      setOpen(true);
      setSkillsPanelOpen(false);
      setAgentConstructorOpen(true);
    });
  }, [setHidden, setOpen]);

  const openSkillsSidebar = useCallback(() => {
    startTransition(() => {
      setHidden(false);
      setOpen(true);
      setAgentConstructorOpen(false);
      setSkillsPanelOpen(true);
    });
  }, [setHidden, setOpen]);

  usePendingAgentConstructorOpen(openConstructorSidebar);
  usePendingSkillSidebarOpen(openSkillsSidebar);

  useEffect(() => {
    const onAgent = () => openConstructorSidebar();
    const onSkills = () => openSkillsSidebar();
    const onTranscription = () => {
      startTransition(() => {
        setHidden(false);
        setOpen(true);
        setTranscriptionMenuOpen(true);
      });
    };
    window.addEventListener(ASTRA_OPEN_AGENT_CONSTRUCTOR, onAgent);
    window.addEventListener(ASTRA_OPEN_SKILLS_SIDEBAR, onSkills);
    window.addEventListener(ASTRA_OPEN_TRANSCRIPTION_SIDEBAR, onTranscription);
    return () => {
      window.removeEventListener(ASTRA_OPEN_AGENT_CONSTRUCTOR, onAgent);
      window.removeEventListener(ASTRA_OPEN_SKILLS_SIDEBAR, onSkills);
      window.removeEventListener(ASTRA_OPEN_TRANSCRIPTION_SIDEBAR, onTranscription);
    };
  }, [openConstructorSidebar, openSkillsSidebar, setHidden, setOpen]);

  const panelIsLight = isSidebarPanelLight(panelBg);

  return (
    <>
      {!hidden && (
        <Drawer
          variant="persistent"
          anchor="right"
          open={true}
          slotProps={{ paper: { className: 'astra-right-rail' } }}
          sx={{
            width: open ? 240 : 64,
            flexShrink: 0,
            transition: 'width 0.3s ease',
            '& .MuiDrawer-paper': {
              width: open ? 240 : 64,
              boxSizing: 'border-box',
              ...getSidebarChromeSx(panelBg),
              ...getSidebarForcedContrastSx(panelBg),
              borderLeft: '1px solid var(--sidebar-border-color, rgba(255,255,255,0.08))',
              transition: 'width 0.3s ease, background 0.3s ease, color 0.3s ease',
              overflowX: 'hidden',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              ...SIDEBAR_HIDE_SCROLLBAR_SX,
            },
          }}
        >
          {!open && (
            <>
              <Box
                sx={{
                  px: 1,
                  py: 1.5,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: 64,
                  boxSizing: 'border-box',
                }}
              >
                <Tooltip title="Открыть панель" placement="left">
                  <IconButton
                    onClick={onToggleOpen}
                    sx={{
                      color: 'white',
                      opacity: 1,
                      width: 40,
                      height: 40,
                      borderRadius: 1,
                      p: 0,
                      '&:hover': {
                        backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
                        opacity: 1,
                      },
                    }}
                  >
                    <SidebarRailMenuGlyph side="right" />
                  </IconButton>
                </Tooltip>
              </Box>
              <List disablePadding sx={{ px: 1, pt: 0, pb: 1, width: '100%', boxSizing: 'border-box' }}>
                <ListItem disablePadding sx={{ mb: 0.5, display: 'block' }}>
                  <Tooltip title="Транскрибация" placement="left">
                    <Box component="span" sx={{ display: 'flex', width: '100%', justifyContent: 'center' }}>
                      <ListItemButton
                        onClick={() => {
                          setOpen(true);
                          setTranscriptionMenuOpen(true);
                        }}
                        sx={getSidebarRailCollapsedListItemButtonSx(panelIsLight)}
                      >
                        <SidebarRailTranscribeIcon sx={SIDEBAR_LIST_ICON_SX} />
                      </ListItemButton>
                    </Box>
                  </Tooltip>
                </ListItem>
                <GalleryNavButton variant="collapsed" isDarkMode={isDarkMode} panelIsLight={panelIsLight} />
                <ListItem disablePadding sx={{ mb: 0.5, display: 'block' }}>
                  <Tooltip title="Skills" placement="left">
                    <Box component="span" sx={{ display: 'flex', width: '100%', justifyContent: 'center' }}>
                      <ListItemButton
                        onClick={openSkillsSidebar}
                        selected={skillsPanelOpen}
                        sx={getSidebarRailCollapsedListItemButtonSx(panelIsLight)}
                      >
                        <SkillsNavIcon sx={SIDEBAR_LIST_ICON_SX} />
                      </ListItemButton>
                    </Box>
                  </Tooltip>
                </ListItem>
                <ListItem disablePadding sx={{ mb: 0.5, display: 'block' }}>
                  <Tooltip title="Конструктор агента" placement="left">
                    <Box component="span" sx={{ display: 'flex', width: '100%', justifyContent: 'center' }}>
                      <ListItemButton
                        onClick={() => {
                          setOpen(true);
                          setSkillsPanelOpen(false);
                          setAgentConstructorOpen(true);
                        }}
                        sx={getSidebarRailCollapsedListItemButtonSx(panelIsLight)}
                      >
                        <SidebarRailAgentIcon sx={SIDEBAR_LIST_ICON_SX} />
                      </ListItemButton>
                    </Box>
                  </Tooltip>
                </ListItem>
              </List>
              <Box
                sx={{
                  position: 'fixed',
                  right: 0,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 64,
                  display: 'flex',
                  justifyContent: 'center',
                  zIndex: 1300,
                }}
              >
                <Tooltip title="Скрыть панель" placement="left">
                  <IconButton
                    onClick={onHide}
                    sx={{
                      color: 'white',
                      opacity: 1,
                      width: 40,
                      height: 40,
                      borderRadius: 1,
                      '&:hover': {
                        backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
                        opacity: 1,
                      },
                    }}
                  >
                    <ChevronRightIcon />
                  </IconButton>
                </Tooltip>
              </Box>
            </>
          )}

          {open && (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                overflow: 'hidden',
                minWidth: 240,
                boxSizing: 'border-box',
              }}
            >
              <Box
                sx={{
                  px: 2,
                  py: 1.5,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  minHeight: 64,
                  flexShrink: 0,
                  boxSizing: 'border-box',
                }}
              >
                <Tooltip title="Свернуть панель" placement="left">
                  <IconButton
                    onClick={onToggleOpen}
                    sx={{
                      color: 'white',
                      opacity: 1,
                      width: 40,
                      height: 40,
                      borderRadius: 1,
                      p: 0,
                      '&:hover': {
                        backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
                        opacity: 1,
                      },
                    }}
                  >
                    <SidebarRailMenuGlyph side="right" />
                  </IconButton>
                </Tooltip>
              </Box>
              <List sx={{ py: 0, px: 1, flexShrink: 0 }}>
                <ListItem disablePadding sx={{ mb: 0.5 }}>
                  <ListItemButton
                    onClick={() => setTranscriptionMenuOpen((prev) => !prev)}
                    sx={{
                      ...SIDEBAR_CHAT_ROW_LIST_ITEM_BUTTON_SX,
                      color: 'white',
                      backgroundColor: transcriptionMenuOpen ? 'rgba(255,255,255,0.15)' : 'transparent',
                      '&:hover': {
                        backgroundColor: transcriptionMenuOpen
                          ? 'rgba(255,255,255,0.2)'
                          : 'rgba(255,255,255,0.08)',
                      },
                    }}
                  >
                    <ListItemIcon
                      sx={{
                        color: '#ffffff',
                        minWidth: 40,
                        mr: `${SIDEBAR_LIST_ICON_TO_TEXT_GAP_PX}px`,
                        '& .MuiSvgIcon-root': { fontSize: '1.375rem' },
                      }}
                    >
                      <SidebarRailTranscribeIcon />
                    </ListItemIcon>
                    <ListItemText
                      primary="Транскрибация"
                      primaryTypographyProps={{
                        sx: { fontSize: '0.8rem', fontWeight: 400, color: '#ffffff' },
                      }}
                    />
                  </ListItemButton>
                </ListItem>
                <TranscriptionSidebarSection open={transcriptionMenuOpen} />
                <GalleryNavButton variant="expanded" isDarkMode={isDarkMode} panelIsLight={panelIsLight} />
                <ListItem disablePadding sx={{ mb: 0.5 }}>
                  <ListItemButton
                    onClick={() => {
                      setSkillsPanelOpen((prev) => {
                        const next = !prev;
                        if (next) setAgentConstructorOpen(false);
                        return next;
                      });
                    }}
                    sx={{
                      ...SIDEBAR_CHAT_ROW_LIST_ITEM_BUTTON_SX,
                      color: 'white',
                      backgroundColor: skillsPanelOpen ? 'rgba(255,255,255,0.15)' : 'transparent',
                      '&:hover': {
                        backgroundColor: skillsPanelOpen
                          ? 'rgba(255,255,255,0.2)'
                          : 'rgba(255,255,255,0.08)',
                      },
                    }}
                  >
                    <ListItemIcon
                      sx={{
                        color: '#ffffff',
                        minWidth: 40,
                        mr: `${SIDEBAR_LIST_ICON_TO_TEXT_GAP_PX}px`,
                        '& .MuiSvgIcon-root': { fontSize: '1.375rem' },
                      }}
                    >
                      <SkillsNavIcon />
                    </ListItemIcon>
                    <ListItemText
                      primary="Skills"
                      primaryTypographyProps={{
                        sx: { fontSize: '0.8rem', fontWeight: 400, color: '#ffffff' },
                      }}
                    />
                  </ListItemButton>
                </ListItem>
              </List>
              {skillsPanelOpen && (
                <Box
                  sx={{
                    flex: 1,
                    minHeight: 0,
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    borderTop: '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  <SkillsSidebarPanel isOpen={true} />
                </Box>
              )}
              <List sx={{ py: 0, px: open ? 1 : 0.5 }}>
                <ListItem disablePadding sx={{ mb: 0.5 }}>
                  <ListItemButton
                    onClick={() => {
                      setAgentConstructorOpen((prev) => {
                        const next = !prev;
                        if (next) setSkillsPanelOpen(false);
                        return next;
                      });
                    }}
                    sx={{
                      ...SIDEBAR_CHAT_ROW_LIST_ITEM_BUTTON_SX,
                      color: 'white',
                      backgroundColor: agentConstructorOpen ? 'rgba(255,255,255,0.15)' : 'transparent',
                      '&:hover': {
                        backgroundColor: agentConstructorOpen
                          ? 'rgba(255,255,255,0.2)'
                          : 'rgba(255,255,255,0.08)',
                      },
                    }}
                  >
                    <ListItemIcon
                      sx={{
                        color: '#ffffff',
                        minWidth: 40,
                        mr: `${SIDEBAR_LIST_ICON_TO_TEXT_GAP_PX}px`,
                        '& .MuiSvgIcon-root': { fontSize: '1.375rem' },
                      }}
                    >
                      <SidebarRailAgentIcon />
                    </ListItemIcon>
                    <ListItemText
                      primary="Конструктор агента"
                      primaryTypographyProps={{
                        sx: { fontSize: '0.8rem', fontWeight: 400, color: '#ffffff' },
                      }}
                    />
                  </ListItemButton>
                </ListItem>
              </List>
              {agentConstructorOpen && (
                <Box
                  sx={{
                    flex: 1,
                    minHeight: 0,
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    borderTop: '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  <AgentConstructorPanel isDarkMode={isDarkMode} isOpen={true} />
                </Box>
              )}
            </Box>
          )}
        </Drawer>
      )}

      {hidden && (
        <Box
          sx={{
            position: 'fixed',
            right: 0,
            top: '50%',
            transform: 'translateY(-50%)',
            zIndex: 1200,
          }}
        >
          <Tooltip title="Показать панель" placement="left">
            <IconButton
              onClick={onShow}
              sx={{
                bgcolor: 'transparent',
                color: 'text.primary',
                opacity: 0.7,
                '&:hover': {
                  bgcolor: 'transparent',
                  opacity: 1,
                },
              }}
            >
              <ChevronLeftIcon />
            </IconButton>
          </Tooltip>
        </Box>
      )}
    </>
  );
}
