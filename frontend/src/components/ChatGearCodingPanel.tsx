import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Chip, FormControlLabel, Switch, TextField, Typography } from '@mui/material';
import { Code as CodeIcon } from '@mui/icons-material';
import { CHAT_GEAR_SCROLL_AREA_NO_VISIBLE_SCROLLBAR_SX, MENU_ACTION_TEXT_SIZE } from '../constants/menuStyles';
import { useAppActions } from '../contexts/AppContext';
import { fetchCodingAgentStatus } from '../coding/api';
import WorkspacePicker from './WorkspacePicker';
import {
  enableCodingFromGearPanel,
  isCodingModeEnabled,
  isCodingPlanModeEnabled,
  setCodingModeEnabled,
  setCodingPlanModeEnabled,
} from '../coding/selectionStorage';
import {
  clearApprovedPlan,
  getApprovedPlan,
  getDraftPlan,
  setApprovedPlan,
  setDraftPlan,
} from '../coding/planStorage';

interface ChatGearCodingPanelProps {
  isDarkMode: boolean;
  chatId: string | null | undefined;
  projectId?: string | null;
}

export default function ChatGearCodingPanel({ isDarkMode, chatId, projectId }: ChatGearCodingPanelProps) {
  const { getProjectById, updateProject, getChatById } = useAppActions();
  const muted = isDarkMode ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.6)';
  const text = isDarkMode ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.9)';

  const resolvedProjectId = useMemo(() => {
    if (projectId) return projectId;
    if (!chatId) return null;
    return getChatById(chatId)?.projectId || null;
  }, [projectId, chatId, getChatById]);

  const project = resolvedProjectId ? getProjectById(resolvedProjectId) : null;

  const [codingOn, setCodingOn] = useState(() => isCodingModeEnabled(chatId));
  const [planOn, setPlanOn] = useState(() => isCodingPlanModeEnabled(chatId));
  const [workspaceDraft, setWorkspaceDraft] = useState(project?.workspacePath || '');
  const [statusEnabled, setStatusEnabled] = useState(true);
  const [draftPlan, setDraftPlanState] = useState(() => getDraftPlan(chatId));
  const [approvedPlan, setApprovedPlanState] = useState(() => getApprovedPlan(chatId));

  useEffect(() => {
    setCodingOn(isCodingModeEnabled(chatId));
    setPlanOn(isCodingPlanModeEnabled(chatId));
  }, [chatId]);

  useEffect(() => {
    const sync = () => {
      setCodingOn(isCodingModeEnabled(chatId));
      setPlanOn(isCodingPlanModeEnabled(chatId));
    };
    window.addEventListener('astrachatCodingSelectionChanged', sync);
    return () => window.removeEventListener('astrachatCodingSelectionChanged', sync);
  }, [chatId]);

  useEffect(() => {
    setWorkspaceDraft(project?.workspacePath || '');
  }, [project?.workspacePath, project?.id]);

  useEffect(() => {
    setDraftPlanState(getDraftPlan(chatId));
    setApprovedPlanState(getApprovedPlan(chatId));
  }, [chatId]);

  useEffect(() => {
    const sync = () => {
      setDraftPlanState(getDraftPlan(chatId));
      setApprovedPlanState(getApprovedPlan(chatId));
    };
    window.addEventListener('astrachatCodingPlanChanged', sync);
    return () => window.removeEventListener('astrachatCodingPlanChanged', sync);
  }, [chatId]);

  useEffect(() => {
    void fetchCodingAgentStatus()
      .then((s) => setStatusEnabled(Boolean(s.enabled)))
      .catch(() => setStatusEnabled(false));
  }, []);

  const toggleCoding = useCallback(
    (_: React.ChangeEvent<HTMLInputElement>, checked: boolean) => {
      setCodingOn(checked);
      setCodingModeEnabled(chatId, checked);
      window.dispatchEvent(new CustomEvent('astrachatCodingSelectionChanged'));
    },
    [chatId],
  );

  const togglePlan = useCallback(
    (_: React.ChangeEvent<HTMLInputElement>, checked: boolean) => {
      setPlanOn(checked);
      setCodingPlanModeEnabled(chatId, checked);
      window.dispatchEvent(new CustomEvent('astrachatCodingSelectionChanged'));
    },
    [chatId],
  );

  const handleWorkspaceChange = useCallback(
    (path: string) => {
      setWorkspaceDraft(path);
      if (project) {
        updateProject(project.id, { workspacePath: path.trim() || undefined });
      }
      if (path.trim()) {
        enableCodingFromGearPanel(chatId);
        setCodingOn(true);
      }
    },
    [project, updateProject, chatId],
  );

  if (!chatId) {
    return (
      <Box sx={{ p: 1.5, maxWidth: 320 }}>
        <Typography variant="body2" sx={{ color: muted, fontSize: MENU_ACTION_TEXT_SIZE }}>
          Выберите чат, чтобы настроить Coding agent.
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        maxWidth: 360,
      }}
    >
      <Box sx={{ px: 1.5, pt: 1.5, pb: 0.75, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CodeIcon sx={{ fontSize: 18, color: text }} />
          <Typography sx={{ color: text, fontSize: MENU_ACTION_TEXT_SIZE, fontWeight: 600 }}>
            Coding agent
          </Typography>
          {!statusEnabled && <Chip size="small" label="выключен на сервере" color="warning" />}
        </Box>

        {!codingOn && (
          <Alert severity="warning" sx={{ py: 0.25, fontSize: 12 }}>
            Coding выключен — сообщения идут в обычный чат.
          </Alert>
        )}

        <FormControlLabel
          control={<Switch size="small" checked={codingOn} onChange={toggleCoding} disabled={!statusEnabled} />}
          label={<Typography sx={{ color: text, fontSize: MENU_ACTION_TEXT_SIZE }}>Включить Coding</Typography>}
        />

        <FormControlLabel
          control={<Switch size="small" checked={planOn} onChange={togglePlan} disabled={!codingOn || !statusEnabled} />}
          label={<Typography sx={{ color: text, fontSize: MENU_ACTION_TEXT_SIZE }}>Plan mode (только чтение)</Typography>}
        />
      </Box>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          px: 1.5,
          pb: 1.5,
          display: 'flex',
          flexDirection: 'column',
          gap: 1.25,
          ...CHAT_GEAR_SCROLL_AREA_NO_VISIBLE_SCROLLBAR_SX,
        }}
      >
        <Typography variant="caption" sx={{ color: muted }}>
          Workspace{project ? ` «${project.name}»` : ' (привяжите чат к проекту)'}
        </Typography>

        <WorkspacePicker
          value={workspaceDraft}
          onChange={handleWorkspaceChange}
          disabled={!project}
          isDarkMode={isDarkMode}
          compact
          showGlobalDefault
        />

        <Typography variant="caption" sx={{ color: muted }}>
          План (checklist)
        </Typography>

        <TextField
          size="small"
          fullWidth
          multiline
          minRows={2}
          maxRows={6}
          disabled={!codingOn}
          placeholder="- [ ] шаг 1&#10;- [ ] шаг 2"
          value={draftPlan}
          onChange={(e) => {
            setDraftPlanState(e.target.value);
            setDraftPlan(chatId, e.target.value);
          }}
          sx={{
            '& .MuiInputBase-input': { color: text, fontSize: 12, fontFamily: 'monospace' },
          }}
        />

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button
            size="small"
            variant="contained"
            disabled={!codingOn || !draftPlan.trim()}
            onClick={() => {
              setApprovedPlan(chatId, draftPlan);
              setApprovedPlanState(draftPlan.trim());
              setCodingPlanModeEnabled(chatId, false);
              setPlanOn(false);
              window.dispatchEvent(new CustomEvent('astrachatCodingSelectionChanged'));
            }}
          >
            Одобрить план → Build
          </Button>
          <Button
            size="small"
            variant="text"
            disabled={!approvedPlan}
            onClick={() => {
              clearApprovedPlan(chatId);
              setApprovedPlanState('');
            }}
          >
            Сбросить план
          </Button>
        </Box>

        {approvedPlan && (
          <Alert severity="success" sx={{ py: 0.25, fontSize: 12 }}>
            Активный план: {approvedPlan.split('\n').filter((l) => l.trim()).length} строк
          </Alert>
        )}
      </Box>
    </Box>
  );
}
