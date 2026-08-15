import React, { useState, useRef, useMemo, useEffect, useLayoutEffect, useCallback, startTransition } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Chip,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  IconButton,
  Divider,
  Paper,
  TextField,
  Collapse,
  CircularProgress,
  Drawer,
  Popover,
  type PopoverActions,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tooltip,
} from '@mui/material';
import {
  Chat as ChatIcon,
  ArrowBack as ArrowBackIcon,
  EditOutlined as EditIcon,
  DeleteOutlined as DeleteIcon,
  MoreVert as MoreVertIcon,
  FolderOutlined as FolderIcon,
  AttachMoney as MoneyIcon,
  Lightbulb as LightbulbIcon,
  Image as ImageIcon,
  PlayArrow as PlayArrowIcon,
  MusicNote as MusicNoteIcon,
  AutoAwesome as SparkleIcon,
  Work as BriefcaseIcon,
  Language as GlobeIcon,
  School as GraduationIcon,
  AccountBalanceWallet as WalletIcon,
  Favorite as FavoriteIcon,
  SportsBaseball as BaseballIcon,
  Restaurant as CutleryIcon,
  LocalCafe as CoffeeIcon,
  Code as CodeIcon,
  LocalFlorist as LeafIcon,
  Pets as CatIcon,
  DirectionsCar as CarIcon,
  MenuBook as BookIcon,
  Cloud as UmbrellaIcon,
  CalendarToday as CalendarIcon,
  Computer as DesktopIcon,
  VolumeUp as SpeakerIcon,
  Assessment as ChartIcon,
  Email as MailIcon,
  Assignment as AssignmentIcon,
  Luggage as LuggageIcon,
  ExpandMore as ExpandMoreIcon,
  Send as SendIcon,
  Mic as MicIcon,
  AttachFile as AttachFileIcon,
  School as SchoolIcon,
  ArchiveOutlined as ArchiveIcon,
  PushPinOutlined as PushPinIcon,
  Close as CloseIcon,
  Refresh as RefreshIcon,
  Clear as ClearIcon,
  AutoStories as KbIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Check as CheckIcon,
  HubOutlined as GearMenuMcpIcon,
  Code as GearMenuCodingIcon,
  SmartToyOutlined as GearMenuAgentsIcon,
  Psychology as ThinkingModeIcon,
  Bolt as FastModeIcon,
  AutoAwesome as AutoModeIcon,
  HistoryEdu as SkillsNavIcon,
  YouTube as YouTubeIcon,
  Upload as UploadIcon,
  Square as SquareIcon,
} from '@mui/icons-material';
import { useAppContext, useAppActions, chatIsListedInAllChatsSection } from '../contexts/AppContext';
import { useSocket } from '../contexts/SocketContext';
import VoiceChatDialog from '../components/VoiceChatDialog';
import TranscriptionResultModal from '../components/TranscriptionResultModal';
import ChatInputBar from '../components/ChatInputBar';
import ChatInputStatusCluster from '../components/ChatInputStatusCluster';
import ChatGearAgentsPanel from '../components/ChatGearAgentsPanel';
import ChatGearMcpPanel from '../components/ChatGearMcpPanel';
import ChatGearCodingPanel from '../components/ChatGearCodingPanel';
import { enableCodingFromGearPanel } from '../coding/selectionStorage';
import ChatGearSkillsPanel from '../components/ChatGearSkillsPanel';
import ChatInputSuggestions from '../components/ChatInputSuggestions';
import {
  estimateLibraryClusterWidthPx,
  getToolsButtonInsetSp,
} from '../components/chatInputLayout';
import { getChatInputSuggestions } from '../chat/getChatInputSuggestions';
import { loadFollowUpSettings } from '../chat/followUpSettings';
import { useChatInputMcpIndicators } from '../mcp/hooks/useChatInputMcpIndicators';
import { useMcpStreamingTools } from '../mcp/hooks/useMcpStreamingTools';
import McpLiveToolsIndicator from '../mcp/components/McpLiveToolsIndicator';
import { copyMcpToolIds, projectMcpChatKey } from '../mcp/selectionStorage';
import { getApiUrl, API_ENDPOINTS } from '../config/api';
import { incrementTabNotification } from '../utils/tabNotifications';
import { useTheme } from '@mui/material/styles';
import AgentConstructorPanel from '../components/AgentConstructorPanel';
import GalleryNavButton from '../components/GalleryNavButton';
import ModelSelector from '../components/ModelSelector';
import AgentSelector from '../components/AgentSelector';
import { usePendingAgentConstructorOpen } from '../hooks/usePendingAgentConstructorOpen';
import { useRightSidebarInsetCssVar } from '../hooks/useRightSidebarInsetCssVar';
import { clearActiveAgent } from '../utils/clearActiveAgent';
import { clearActiveSkills } from '../utils/skillSelectionStorage';
import { useActiveSkillIndicators } from '../hooks/useActiveSkillIndicators';
import {
  getProjectIconGlyphSx,
  getDropdownItemSx,
  MENU_ACTION_TEXT_SIZE,
  MENU_COMPACT_PANEL_WIDTH_PX,
  CHAT_GEAR_MENU_PANEL_WIDTH_PX,
  CHAT_GEAR_MENU_LEFT_RAIL_WIDTH_PX,
  CHAT_GEAR_MENU_EXPANDED_WIDTH_PX,
  CHAT_GEAR_MENU_AGENTS_RIGHT_MIN_PX,
  CHAT_GEAR_MENU_PANELS_GAP_PX,
  CHAT_GEAR_MENU_ANCHOR_VERTICAL_OFFSET,
  CHAT_GEAR_MENU_PAPER_MAX_HEIGHT,
  CHAT_GEAR_MENU_PAPER_MAX_HEIGHT_PX,
  getChatGearMenuPaperHeightPx,
  CHAT_GEAR_MENU_MARGIN_THRESHOLD_PX,
  CHAT_GEAR_SCROLL_AREA_NO_VISIBLE_SCROLLBAR_SX,
  DROPDOWN_ITEM_HOVER_BG_DARK,
  DROPDOWN_ITEM_HOVER_BG_LIGHT,
  DROPDOWN_CHEVRON_SX,
  getDropdownPanelSx,
  SIDEBAR_CHAT_ROW_LIST_ITEM_BUTTON_SX,
  SIDEBAR_LIST_ICON_SX,
  SIDEBAR_LIST_ICON_TO_TEXT_GAP_PX,
  SIDEBAR_HIDE_SCROLLBAR_SX,
  getSidebarRailCollapsedListItemButtonSx,
} from '../constants/menuStyles';
import SidebarRailMenuGlyph from '../components/SidebarRailMenuGlyph';
import {
  SidebarRailTranscribeIcon,
  SidebarRailAgentIcon,
} from '../constants/sidebarRailIcons';
import {
  getSidebarPanelBackground,
  getSidebarChromeSx,
  getSidebarForcedContrastSx,
  isSidebarPanelLight,
} from '../constants/sidebarPanelColor';
import { getWorkZoneBackgroundColor, getWorkZoneCustomImage, isWorkZoneAnimatedMode } from '../constants/workZoneBackground';
import { useWorkZoneBgMode } from '../hooks/useWorkZoneBgMode';
import { useMyAgentSelection } from '../hooks/useChatInputAgentIndicators';
import { useRagReindexStatus } from '../hooks/useRagReindexStatus';
import {
  MEMORY_RAG_DISABLED_HINT,
  RAG_REINDEX_BLOCK_PLACEHOLDER,
} from '../utils/ragReindexBlock';
import WorkZoneStarrySky from '../components/WorkZoneStarrySky';
import WorkZoneSnowfall from '../components/WorkZoneSnowfall';
import {
  isKnowledgeRagEnabled,
  setKnowledgeRagEnabled,
  KNOWLEDGE_RAG_STORAGE_EVENT,
} from '../utils/knowledgeRagStorage';
import {
  ASTRA_TRIGGER_ATTACH,
  ASTRA_OPEN_AGENT_CONSTRUCTOR,
  ASTRA_OPEN_TRANSCRIPTION_SIDEBAR,
} from '../constants/hotkeys';
import {
  MODEL_THINKING_MODE_STORAGE_KEY,
  ModelThinkingMode,
} from '../utils/modelThinking';

const projectIconMap: Record<string, React.ComponentType<any>> = {
  folder: FolderIcon,
  money: MoneyIcon,
  lightbulb: LightbulbIcon,
  gallery: ImageIcon,
  video: PlayArrowIcon,
  music: MusicNoteIcon,
  sparkle: SparkleIcon,
  edit: EditIcon,
  briefcase: BriefcaseIcon,
  globe: GlobeIcon,
  graduation: GraduationIcon,
  wallet: WalletIcon,
  heart: FavoriteIcon,
  baseball: BaseballIcon,
  cutlery: CutleryIcon,
  coffee: CoffeeIcon,
  code: CodeIcon,
  leaf: LeafIcon,
  cat: CatIcon,
  car: CarIcon,
  book: BookIcon,
  umbrella: UmbrellaIcon,
  calendar: CalendarIcon,
  desktop: DesktopIcon,
  speaker: SpeakerIcon,
  chart: ChartIcon,
  mail: MailIcon,
  assignment: AssignmentIcon,
  luggage: LuggageIcon,
};

type ModelSelectorMode = 'settings' | 'workspace' | 'workspace_agent';

const readModelSelectorMode = (): ModelSelectorMode => {
  const saved = localStorage.getItem('model_selector_mode');
  if (saved === 'settings' || saved === 'workspace' || saved === 'workspace_agent') return saved;
  const oldBool = localStorage.getItem('show_model_selector_in_settings');
  return oldBool === 'true' ? 'settings' : 'workspace_agent';
};

interface ProjectPageProps {
  sidebarOpen?: boolean;
  sidebarHidden?: boolean;
}

export default function ProjectPage({ sidebarOpen = true, sidebarHidden = false }: ProjectPageProps) {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const theme = useTheme();
  const { state } = useAppContext();
  const { getProjectById, setCurrentChat, createChat, moveChatToProject, updateChatTitle, deleteChat, archiveChat, getChatById, moveChatToFolder, togglePinInProject, showNotification } = useAppActions();
  const { sendMessage, isConnected, isConnecting } = useSocket();
  const [chatsExpanded, setChatsExpanded] = useState(true);
  const [inputMessage, setInputMessage] = useState('');
  const [chatSuggestionsEnabled, setChatSuggestionsEnabled] = useState(
    () => loadFollowUpSettings().followUpAutoGenerate,
  );
  const [modelSelectorMode, setModelSelectorMode] = useState<ModelSelectorMode>(readModelSelectorMode);
  const [isSending, setIsSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onAttach = () => fileInputRef.current?.click();
    window.addEventListener(ASTRA_TRIGGER_ATTACH, onAttach);
    return () => window.removeEventListener(ASTRA_TRIGGER_ATTACH, onAttach);
  }, []);

  useEffect(() => {
    const syncInterfaceSettings = () => {
      setChatSuggestionsEnabled(loadFollowUpSettings().followUpAutoGenerate);
      setModelSelectorMode(readModelSelectorMode());
    };
    syncInterfaceSettings();
    window.addEventListener('interfaceSettingsChanged', syncInterfaceSettings);
    return () => window.removeEventListener('interfaceSettingsChanged', syncInterfaceSettings);
  }, []);

  const [chatMenuAnchor, setChatMenuAnchor] = useState<null | HTMLElement>(null);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  // Защита от "мгновенного" onBlur после клика по пункту меню.
  // Popover закрывается, фокус уходит с TextField, и режим редактирования может
  // сразу схлопнуться, выглядя как "кнопка не работает".
  const editingStartedAtRef = useRef<number>(0);
  const [uploadedFiles, setUploadedFiles] = useState<Array<{ name: string; type: string }>>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  /** Раскрытый подпункт меню «Инструменты» (панель агентов). */
  const [gearToolsPanel, setGearToolsPanel] = useState<'main' | 'agents' | 'skills' | 'mcp' | 'coding' | 'model-mode'>('main');
  const gearSubPanelOpen =
    gearToolsPanel === 'agents' || gearToolsPanel === 'skills' || gearToolsPanel === 'model-mode' || gearToolsPanel === 'mcp' || gearToolsPanel === 'coding';
  const [modelThinkingMode, setModelThinkingMode] = useState<ModelThinkingMode>(() => {
    const saved = (localStorage.getItem(MODEL_THINKING_MODE_STORAGE_KEY) || 'fast') as ModelThinkingMode;
    return saved === 'auto' || saved === 'thinking' || saved === 'fast' ? saved : 'fast';
  });
  const gearToolsPopoverActionRef = useRef<PopoverActions | null>(null);
  /** Якорь меню «Инструменты» — вся оболочка поля ввода (верх), а не кнопка виджетов */
  const chatInputToolsAnchorRef = useRef<HTMLDivElement>(null);
  /** Ширина меню «Инструменты» = ширина пилюли ввода. */
  const [gearToolsMenuWidthPx, setGearToolsMenuWidthPx] = useState<number | null>(null);
  const [gearToolsPaperHeightPx, setGearToolsPaperHeightPx] = useState<number | null>(null);
  const [transcriptionModalOpen, setTranscriptionModalOpen] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionResult, setTranscriptionResult] = useState('');
  const [transcriptionMenuOpen, setTranscriptionMenuOpen] = useState(false);
  const [transcriptionYoutubeUrl, setTranscriptionYoutubeUrl] = useState('');
  const [transcriptionId, setTranscriptionId] = useState<string | null>(null);
  const transcriptionFileInputRef = useRef<HTMLInputElement>(null);
  const [showVoiceDialog, setShowVoiceDialog] = useState(false);
  const [chatInputStyle, setChatInputStyle] = useState<'compact' | 'classic'>(() =>
    (localStorage.getItem('chat_input_style') as 'compact' | 'classic') || 'compact'
  );
  const [useKbRag, setUseKbRag] = useState(() => isKnowledgeRagEnabled());


  const toggleKbRag = useCallback(() => {
    setUseKbRag((prev) => {
      const next = !prev;
      setKnowledgeRagEnabled(next);
      return next;
    });
  }, []);

  const myAgentSelection = useMyAgentSelection();
  const {
    shouldBlockRagSend: shouldBlockRagSendForChat,
    blockMessage: ragReindexBlockMessage,
    memoryRagEnabled,
  } = useRagReindexStatus();

  useEffect(() => {
    const onRag = () => setUseKbRag(isKnowledgeRagEnabled());
    window.addEventListener(KNOWLEDGE_RAG_STORAGE_EVENT, onRag);
    return () => window.removeEventListener(KNOWLEDGE_RAG_STORAGE_EVENT, onRag);
  }, []);

  useEffect(() => {
    localStorage.setItem(MODEL_THINKING_MODE_STORAGE_KEY, modelThinkingMode);
  }, [modelThinkingMode]);

  useLayoutEffect(() => {
    if (!anchorEl) return;
    const shell = chatInputToolsAnchorRef.current;
    if (shell) {
      const rect = shell.getBoundingClientRect();
      setGearToolsMenuWidthPx(Math.round(rect.width));
      setGearToolsPaperHeightPx(getChatGearMenuPaperHeightPx(rect.top));
    }
    gearToolsPopoverActionRef.current?.updatePosition();
  }, [anchorEl, gearToolsPanel]);

  useEffect(() => {
    if (!anchorEl) return;
    const shell = chatInputToolsAnchorRef.current;
    if (!shell || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const rect = shell.getBoundingClientRect();
      setGearToolsMenuWidthPx(Math.round(rect.width));
      setGearToolsPaperHeightPx(getChatGearMenuPaperHeightPx(rect.top));
      queueMicrotask(() => gearToolsPopoverActionRef.current?.updatePosition());
    });
    ro.observe(shell);
    return () => ro.disconnect();
  }, [anchorEl]);

  // Слушаем изменение стиля поля ввода через настройки
  React.useEffect(() => {
    const handler = () => {
      setChatInputStyle((localStorage.getItem('chat_input_style') as 'compact' | 'classic') || 'compact');
    };
    window.addEventListener('interfaceSettingsChanged', handler);
    return () => window.removeEventListener('interfaceSettingsChanged', handler);
  }, []);

  const project = projectId ? getProjectById(projectId) : null;

  const ragSendBlocked = useMemo(
    () => shouldBlockRagSendForChat({ libraryEnabled: useKbRag }),
    [shouldBlockRagSendForChat, useKbRag],
  );

  const mcpScopeChatId = projectId ? projectMcpChatKey(projectId) : null;
  const activeMcpServers = useChatInputMcpIndicators(mcpScopeChatId);
  const activeSkills = useActiveSkillIndicators();
  const { activeMcpTools } = useMcpStreamingTools();
  const isDarkMode = theme.palette.mode === 'dark';

  const handleOpenMcpGearPanel = useCallback(() => {
    const shell = chatInputToolsAnchorRef.current;
    if (shell) {
      setGearToolsPanel('mcp');
      setAnchorEl(shell);
      const rect = shell.getBoundingClientRect();
      setGearToolsMenuWidthPx(Math.round(rect.width));
      setGearToolsPaperHeightPx(getChatGearMenuPaperHeightPx(rect.top));
    }
  }, []);

  const handleClearMyAgent = useCallback(() => {
    clearActiveAgent();
    showNotification('info', 'Агент снят');
  }, [showNotification]);

  const handleClearSkills = useCallback(() => {
    clearActiveSkills();
    showNotification('info', 'Skills отключены');
  }, [showNotification]);

  const libraryInputBadge = useMemo(
    () => (
      <ChatInputStatusCluster
        isDarkMode={isDarkMode}
        libraryActive={useKbRag}
        onLibraryToggle={toggleKbRag}
        myAgentName={myAgentSelection?.name ?? null}
        onAgentToggle={myAgentSelection?.name ? handleClearMyAgent : undefined}
        activeSkills={activeSkills}
        onSkillsToggle={activeSkills.length ? handleClearSkills : undefined}
        activeMcpServers={activeMcpServers}
        onMcpClick={handleOpenMcpGearPanel}
      />
    ),
    [
      isDarkMode,
      useKbRag,
      toggleKbRag,
      myAgentSelection?.name,
      handleClearMyAgent,
      activeSkills,
      handleClearSkills,
      activeMcpServers,
      handleOpenMcpGearPanel,
    ],
  );

  const mcpInputSuggestions = useMemo(() => {
    if (!activeMcpTools.length) return null;
    return <McpLiveToolsIndicator tools={activeMcpTools} />;
  }, [activeMcpTools]);

  const enabledMcpServerIds = useMemo(
    () => activeMcpServers.map((s) => s.id),
    [activeMcpServers],
  );

  const chatInputSuggestionsCatalog = useMemo(
    () => getChatInputSuggestions(enabledMcpServerIds, useKbRag),
    [enabledMcpServerIds, useKbRag],
  );

  const suggestionsContentInset = useMemo(() => {
    const mcpLabel =
      activeMcpServers.length === 1
        ? activeMcpServers[0].display_name
        : activeMcpServers.length > 1
          ? `${activeMcpServers.length} MCP`
          : '';
    const skillsLabel =
      activeSkills.length === 1
        ? (activeSkills[0].name || activeSkills[0].slug || 'Skill').trim()
        : activeSkills.length > 1
          ? `${activeSkills.length} Skills`
          : '';
    const clusterWidth = estimateLibraryClusterWidthPx(
      useKbRag,
      Boolean(myAgentSelection?.name),
      activeMcpServers.length > 0,
      mcpLabel,
      activeSkills.length > 0,
      skillsLabel,
    );
    return getToolsButtonInsetSp(chatInputStyle, clusterWidth);
  }, [
    useKbRag,
    myAgentSelection?.name,
    activeMcpServers,
    activeSkills,
    chatInputStyle,
  ]);

  const renderChatInputSuggestions = (maxWidth: string | number) => {
    if (!chatSuggestionsEnabled) return null;
    return (
    <ChatInputSuggestions
      suggestions={chatInputSuggestionsCatalog}
      inputValue={inputMessage}
      disabled={isSending}
      isDarkMode={isDarkMode}
      maxWidth={maxWidth}
      contentInset={suggestionsContentInset}
      onSelect={(text) => {
        setInputMessage(text);
        inputRef.current?.focus();
      }}
    />
    );
  };
  const dropdownPanelSx = getDropdownPanelSx(isDarkMode);
  const dropdownItemSx = useMemo(() => getDropdownItemSx(isDarkMode), [isDarkMode]);

  // ─── Правый сайдбар (как в UnifiedChatPage) ────────────────────────────────
  const [rightSidebarOpen, setRightSidebarOpen] = useState(() => {
    const saved = localStorage.getItem('rightSidebarOpen');
    return saved !== null ? saved === 'true' : false;
  });
  const [rightSidebarHidden, setRightSidebarHidden] = useState(() => {
    const saved = localStorage.getItem('rightSidebarHidden');
    return saved !== null ? saved === 'true' : false;
  });
  const [rightSidebarPanelBg, setRightSidebarPanelBg] = useState(() => getSidebarPanelBackground());
  const [agentConstructorOpen, setAgentConstructorOpen] = useState(false);
  const workZoneMode = useWorkZoneBgMode();
  const workZoneAnimated = isWorkZoneAnimatedMode(workZoneMode);
  const workZoneBgColor = getWorkZoneBackgroundColor(isDarkMode, workZoneMode);
  const workZoneCustomImage = getWorkZoneCustomImage();

  const openConstructorSidebar = useCallback(() => {
    startTransition(() => {
      setRightSidebarHidden(false);
      setRightSidebarOpen(true);
      setAgentConstructorOpen(true);
    });
  }, []);

  usePendingAgentConstructorOpen(openConstructorSidebar);

  useEffect(() => {
    const onAgent = () => {
      openConstructorSidebar();
    };
    const onTranscription = () => {
      startTransition(() => {
        setRightSidebarHidden(false);
        setRightSidebarOpen(true);
        setTranscriptionMenuOpen(true);
      });
    };
    window.addEventListener(ASTRA_OPEN_AGENT_CONSTRUCTOR, onAgent);
    window.addEventListener(ASTRA_OPEN_TRANSCRIPTION_SIDEBAR, onTranscription);
    return () => {
      window.removeEventListener(ASTRA_OPEN_AGENT_CONSTRUCTOR, onAgent);
      window.removeEventListener(ASTRA_OPEN_TRANSCRIPTION_SIDEBAR, onTranscription);
    };
  }, [openConstructorSidebar]);

  useEffect(() => {
    const onColorChanged = () => setRightSidebarPanelBg(getSidebarPanelBackground());
    window.addEventListener('sidebarColorChanged', onColorChanged);
    return () => window.removeEventListener('sidebarColorChanged', onColorChanged);
  }, []);

  useEffect(() => {
    localStorage.setItem('rightSidebarOpen', String(rightSidebarOpen));
  }, [rightSidebarOpen]);

  useEffect(() => {
    localStorage.setItem('rightSidebarHidden', String(rightSidebarHidden));
  }, [rightSidebarHidden]);

  useRightSidebarInsetCssVar(rightSidebarOpen, rightSidebarHidden);
  
  // Получаем чаты проекта и сортируем: запиненные сначала
  const projectChats = React.useMemo(() => {
    if (!project) return [];
    
    const chats = state.chats.filter(
      (chat) =>
        chat.projectId === projectId &&
        !chat.isArchived &&
        chatIsListedInAllChatsSection(chat)
    );
    
    // Сортируем: запиненные чаты сначала
    return chats.sort((a, b) => {
      const aIsPinned = a.isPinnedInProject || false;
      const bIsPinned = b.isPinnedInProject || false;
      
      if (aIsPinned && !bIsPinned) return -1;
      if (!aIsPinned && bIsPinned) return 1;
      
      // Если оба запинены или оба незапинены, сортируем по дате обновления
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [project, projectId, state.chats]);

  const renderProjectIcon = () => {
    if (!project) return null;
    const iconColor = project.iconColor || '#9ca3af';
    const slotPx = 32; // раньше это был «круг»
    const glyphPx = Math.round(slotPx * 0.9);
    const glyphSx = getProjectIconGlyphSx(glyphPx, iconColor);
    if (project.iconType === 'emoji' && project.icon) {
      return (
        <Box
          sx={{
            width: slotPx,
            height: slotPx,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: `${glyphPx}px`,
            lineHeight: 1,
            color: iconColor,
            transform: 'translateY(-0.25px)',
          }}
        >
          {project.icon}
        </Box>
      );
    }
    if (project.iconType === 'icon' && project.icon) {
      const IconComponent = projectIconMap[project.icon] || FolderIcon;
      return (
        <Box
          sx={{
            width: slotPx,
            height: slotPx,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: iconColor,
          }}
        >
          <IconComponent sx={{ ...glyphSx, fontSize: `${glyphPx}px`, color: 'currentColor' }} />
        </Box>
      );
    }
    return (
      <Box
        sx={{
          width: slotPx,
          height: slotPx,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: iconColor,
        }}
      >
        <FolderIcon sx={{ ...glyphSx, fontSize: `${glyphPx}px`, color: 'currentColor' }} />
      </Box>
    );
  };

  if (!project) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="h6">Проект не найден</Typography>
        <Button onClick={() => navigate('/')} sx={{ mt: 2 }}>
          Вернуться на главную
        </Button>
      </Box>
    );
  }

  const handleSelectChat = (chatId: string) => {
    setCurrentChat(chatId);
    navigate('/');
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || (!isConnected && !isConnecting) || isSending || !projectId) {
      return;
    }

    setIsSending(true);
    
    try {
      // Создаем новый чат
      const chatId = createChat();
      
      // Перемещаем чат в проект
      moveChatToProject(chatId, projectId);
      
      // Устанавливаем название чата на основе первого сообщения
      const title = inputMessage.length > 50 
        ? inputMessage.substring(0, 50) + '...'
        : inputMessage;
      updateChatTitle(chatId, title);
      
      // Устанавливаем как текущий чат
      setCurrentChat(chatId);

      if (projectId) {
        copyMcpToolIds(projectMcpChatKey(projectId), chatId);
      }
      
      // Отправляем сообщение; передаём projectId явно, так как state может не успеть обновиться
      await sendMessage(inputMessage.trim(), chatId, true, projectId);
      
      // Переходим на страницу чата
      navigate('/');
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setIsSending(false);
      setInputMessage('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleRemoveFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleTranscriptionFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    const file = files[0];
    const allowedTypes = [
      'audio/mpeg', 'audio/wav', 'audio/m4a', 'audio/aac', 'audio/flac',
      'video/mp4', 'video/avi', 'video/mov', 'video/mkv', 'video/webm',
    ];
    const isValidType = allowedTypes.some(type =>
      file.type.includes(type.split('/')[1]) || file.name.toLowerCase().includes(type.split('/')[1])
    );
    if (!isValidType) {
      showNotification('error', 'Поддерживаются только аудио и видео файлы');
      e.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024 * 1024) {
      showNotification('error', 'Размер файла не должен превышать 5GB');
      e.target.value = '';
      return;
    }
    e.target.value = '';
    startFileTranscriptionFromSidebar(file);
  };

  const startFileTranscriptionFromSidebar = async (file: File) => {
    setIsTranscribing(true);
    const currentId = `transcribe_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    setTranscriptionId(currentId);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('request_id', currentId);
      const response = await fetch(getApiUrl(API_ENDPOINTS.TRANSCRIBE_UPLOAD), {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        if (response.status === 499) {
          const errorData = await response.json().catch(() => ({ detail: 'Транскрибация была остановлена' }));
          throw Object.assign(new Error(errorData.detail || 'Транскрибация была остановлена'), { status: 499 });
        }
        const errorData = await response.json().catch(() => ({ detail: 'Ошибка при транскрибации' }));
        throw new Error(errorData.detail || 'Ошибка при транскрибации');
      }
      const result = await response.json();
      if (result.success) {
        if (result.transcription_id) setTranscriptionId(result.transcription_id);
        const text = result.transcription ?? '';
        setTranscriptionResult(text);
        showNotification('success', 'Транскрибация завершена');
        incrementTabNotification();
      } else {
        showNotification('error', result.message || 'Ошибка при транскрибации');
      }
    } catch (err: any) {
      if (err?.status === 499 || err?.message?.includes('остановлена')) {
        showNotification('info', 'Транскрибация была остановлена');
      } else {
        showNotification('error', err?.message || 'Ошибка при отправке файла');
      }
    } finally {
      setIsTranscribing(false);
      setTranscriptionId(null);
    }
  };

  const handleStopTranscriptionFromSidebar = async () => {
    if (!transcriptionId) return;
    try {
      const response = await fetch(getApiUrl('/api/transcribe/stop'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcription_id: transcriptionId }),
      });
      const result = await response.json();
      if (result.success) {
        showNotification('info', 'Транскрибация остановлена');
      } else {
        showNotification('error', result.message || 'Ошибка остановки');
      }
    } catch {
      showNotification('error', 'Ошибка при остановке транскрибации');
    }
    setTranscriptionId(null);
    setIsTranscribing(false);
  };

  const startYouTubeTranscriptionFromSidebar = async () => {
    const url = transcriptionYoutubeUrl.trim();
    if (!url) {
      showNotification('warning', 'Введите URL YouTube видео');
      return;
    }
    if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
      showNotification('error', 'Некорректный URL YouTube');
      return;
    }
    setIsTranscribing(true);
    try {
      const response = await fetch(getApiUrl(API_ENDPOINTS.TRANSCRIBE_YOUTUBE), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const result = await response.json();
      if (result.success) {
        setTranscriptionResult(result.transcription ?? '');
        showNotification('success', 'Транскрибация YouTube завершена');
        incrementTabNotification();
      } else {
        showNotification('error', result.message || 'Ошибка при транскрибации YouTube');
      }
    } catch {
      showNotification('error', 'Ошибка при обработке YouTube URL');
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setGearToolsPanel('main');
    setAnchorEl(chatInputToolsAnchorRef.current ?? event.currentTarget);
    const shell = chatInputToolsAnchorRef.current;
    if (shell) {
      const rect = shell.getBoundingClientRect();
      setGearToolsMenuWidthPx(Math.round(rect.width));
      setGearToolsPaperHeightPx(getChatGearMenuPaperHeightPx(rect.top));
    } else {
      setGearToolsMenuWidthPx(null);
      setGearToolsPaperHeightPx(null);
    }
  };

  const handleMenuClose = () => {
    setGearToolsPanel('main');
    setAnchorEl(null);
    setGearToolsMenuWidthPx(null);
    setGearToolsPaperHeightPx(null);
  };

  const handleChatMenuClick = (event: React.MouseEvent<HTMLElement>, chatId: string) => {
    event.stopPropagation();
    setChatMenuAnchor(event.currentTarget);
    setSelectedChatId(chatId);
  };

  const handleChatMenuClose = () => {
    setChatMenuAnchor(null);
  };

  const handleChatMenuAction = (action: string) => {
    if (!selectedChatId) {
      return;
    }

    switch (action) {
      case 'pin':
        // Переключаем закрепление внутри проекта
        togglePinInProject(selectedChatId);
        handleChatMenuClose();
        setSelectedChatId(null);
        break;
      case 'rename':
        const chat = projectChats.find(c => c.id === selectedChatId);
        if (chat) {
          editingStartedAtRef.current = Date.now();
          setChatsExpanded(true); // чтобы поле редактирования было видно пользователю
          setEditingChatId(selectedChatId);
          setEditingTitle(chat.title);
        }
        handleChatMenuClose();
        break;
      case 'archive':
        archiveChat(selectedChatId);
        handleChatMenuClose();
        setSelectedChatId(null);
        break;
      case 'removeFromProject':
        moveChatToProject(selectedChatId, null);
        handleChatMenuClose();
        setSelectedChatId(null);
        break;
      case 'delete':
        setShowDeleteDialog(true);
        handleChatMenuClose();
        break;
      default:
        handleChatMenuClose();
        break;
    }
  };

  const handleConfirmDelete = () => {
    if (selectedChatId) {
      deleteChat(selectedChatId);
      if (state.currentChatId === selectedChatId) {
        const remainingChats = projectChats.filter(chat => chat.id !== selectedChatId);
        if (remainingChats.length > 0) {
          setCurrentChat(remainingChats[0].id);
        } else {
          setCurrentChat(null);
        }
      }
      setShowDeleteDialog(false);
      setSelectedChatId(null);
    }
  };

  const handleSaveEdit = () => {
    if (editingChatId && editingTitle.trim()) {
      const dt = Date.now() - editingStartedAtRef.current;
      // Если blur случился сразу после входа в режим редактирования,
      // игнорируем автосохранение, чтобы пользователь успел увидеть поле.
      if (dt >= 0 && dt < 250) return;
      updateChatTitle(editingChatId, editingTitle.trim());
      setEditingChatId(null);
      setEditingTitle('');
    }
  };

  const handleKeyPressEdit = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      setEditingChatId(null);
      setEditingTitle('');
    }
  };

  const formatChatDate = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Сегодня';
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Вчера';
    } else {
      return date.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'short',
      });
    }
  };

  return (
    <Box 
      sx={{ 
        height: '100vh', 
        display: 'flex', 
        flexDirection: 'column',
        position: 'relative',
        backgroundColor: workZoneBgColor,
        ...(workZoneMode === 'custom' && workZoneCustomImage
          ? {
              backgroundImage: `url("${workZoneCustomImage}")`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
            }
          : {}),
      }}
    >
      {workZoneMode === 'starry' ? <WorkZoneStarrySky isDarkMode={isDarkMode} /> : null}
      {workZoneMode === 'snowfall' ? <WorkZoneSnowfall isDarkMode={isDarkMode} /> : null}

      {/* Селектор моделей — как в обычном чате, левый верхний угол */}
      {(modelSelectorMode === 'workspace' || modelSelectorMode === 'workspace_agent') && (
        <Box
          sx={{
            position: 'absolute',
            top: 16,
            left: sidebarHidden ? 16 : sidebarOpen ? 16 : 80,
            zIndex: 1200,
            transition: 'left 0.3s ease',
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
          }}
        >
          {modelSelectorMode === 'workspace' && (
            <ModelSelector isDarkMode={isDarkMode} onModelSelect={() => {}} />
          )}
          {modelSelectorMode === 'workspace_agent' && (
            <AgentSelector isDarkMode={isDarkMode} triggerMaxWidth={180} onModelSelect={() => {}} />
          )}
        </Box>
      )}

      {/* Основной контент с центрированием */}
      <Box
        sx={{
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          px: 3,
          py: 8,
          marginRight: rightSidebarHidden ? 0 : (rightSidebarOpen ? 0 : '-64px'),
          transition: 'margin-right 0.3s ease',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* Заголовок проекта */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 4 }}>
          {renderProjectIcon()}
          <Typography
            variant="h4"
            sx={{
              fontWeight: 600,
              color: theme.palette.mode === 'dark' ? 'white' : '#333',
            }}
          >
            {project.name}
          </Typography>
        </Box>

        {/* Объединенное поле ввода с кнопками */}
        <ChatInputBar
          toolsMenuAnchorRef={chatInputToolsAnchorRef}
          value={inputMessage}
          onChange={setInputMessage}
          onKeyPress={handleKeyPress}
          placeholder={
            ragSendBlocked
              ? ragReindexBlockMessage || RAG_REINDEX_BLOCK_PLACEHOLDER
              : !isConnected && !isConnecting
                ? 'Нет соединения с сервером'
                : isSending
                  ? 'Отправка сообщения...'
                  : 'Чем я могу помочь вам сегодня?'
          }
          inputDisabled={(!isConnected && !isConnecting) || isSending || ragSendBlocked}
          inputRef={inputRef}
          isDarkMode={theme.palette.mode === 'dark'}
          solidWorkZoneBackground={workZoneAnimated}
          styleVariant={chatInputStyle}
          containerSx={{
            mb: 3,
            p: chatInputStyle === 'classic' ? 0 : 1.5,
            px: chatInputStyle === 'classic' ? 0 : 2,
            borderRadius: chatInputStyle === 'classic' ? '28px' : '28px',
            maxWidth: '800px',
            width: '100%',
            mx: 'auto',
          }}
          fileInputRef={fileInputRef}
          onAttachClick={() => fileInputRef.current?.click()}
          onFileSelect={(files) => {
            if (files?.length) {
              setUploadedFiles(prev => [...prev, ...Array.from(files).map(f => ({ name: f.name, type: f.type }))]);
            }
          }}
          uploadedFiles={uploadedFiles}
          onFileRemove={(_, index) => handleRemoveFile(index)}
          isUploading={isUploading}
          attachDisabled={isUploading || isSending}
          onSettingsClick={handleMenuOpen}
          settingsDisabled={isSending}
          onSendClick={handleSendMessage}
          sendDisabled={!inputMessage.trim() || (!isConnected && !isConnecting) || isSending || ragSendBlocked}
          isSending={isSending}
          onVoiceClick={() => setShowVoiceDialog(true)}
          voiceDisabled={isSending}
          voiceTooltip="Голосовой ввод"
          libraryBadge={libraryInputBadge}
          inputSuggestions={mcpInputSuggestions}
        />
        {renderChatInputSuggestions('800px')}

        {/* Список чатов */}
        {projectChats.length > 0 && (
          <Box
            sx={{
              width: '100%',
              maxWidth: '800px',
            }}
          >
            <Box
              onClick={() => setChatsExpanded(!chatsExpanded)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                px: 2,
                py: 1.5,
                cursor: 'pointer',
                borderRadius: 2,
                mb: 1,
                '&:hover': {
                  bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                },
              }}
            >
              <Typography
                variant="subtitle2"
                sx={{
                  fontWeight: 500,
                  color: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.7)',
                }}
              >
                Чаты
              </Typography>
              <ExpandMoreIcon
                sx={{
                  fontSize: '1.2rem',
                  color: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.7)',
                  transform: chatsExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                  transition: 'transform 0.2s ease',
                }}
              />
            </Box>

            <Collapse in={chatsExpanded}>
              <List sx={{ py: 0 }}>
                {projectChats.map((chat) => {
                  return (
                    <ListItem
                      key={chat.id}
                      disablePadding
                      sx={{ mb: 0.5 }}
                      secondaryAction={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography
                            variant="caption"
                            sx={{
                              color: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)',
                              fontSize: '0.75rem',
                            }}
                          >
                            {formatChatDate(chat.updatedAt)}
                          </Typography>
                          <IconButton
                            size="small"
                            onClick={(e) => handleChatMenuClick(e, chat.id)}
                            sx={{
                              opacity: 0,
                              transition: 'opacity 0.2s',
                              '.MuiListItem-root:hover &': {
                                opacity: 1,
                              },
                              color: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)',
                            }}
                          >
                            <MoreVertIcon fontSize="small" />
                          </IconButton>
                        </Box>
                      }
                    >
                      <ListItemButton
                        onClick={(e) => {
                          if (editingChatId === chat.id) {
                            e.stopPropagation();
                            return;
                          }
                          handleSelectChat(chat.id);
                        }}
                        sx={{
                          borderRadius: 2,
                          py: 1.5,
                          px: 2,
                          '&:hover': {
                            bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                          },
                        }}
                      >
                        <ListItemText
                        primary={
                          editingChatId === chat.id ? (
                            <TextField
                              value={editingTitle}
                              onChange={(e) => setEditingTitle(e.target.value)}
                              onBlur={handleSaveEdit}
                              onKeyDown={handleKeyPressEdit}
                              onClick={(e) => e.stopPropagation()}
                              autoFocus
                              size="small"
                              fullWidth
                              sx={{
                                '& .MuiInputBase-input': {
                                  color: theme.palette.mode === 'dark' ? 'white' : '#333',
                                  fontSize: '0.875rem',
                                  py: 0.5,
                                },
                                '& .MuiOutlinedInput-notchedOutline': {
                                  borderColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)',
                                },
                                '&:hover .MuiOutlinedInput-notchedOutline': {
                                  borderColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)',
                                },
                                '& .MuiOutlinedInput-root': {
                                  '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                                    borderColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)',
                                  },
                                },
                              }}
                            />
                          ) : (
                            <Typography
                              variant="body2"
                              sx={{
                                fontWeight: 400,
                                color: theme.palette.mode === 'dark' ? 'white' : '#333',
                              }}
                            >
                              {chat.title}
                            </Typography>
                          )
                        }
                      />
                      </ListItemButton>
                    </ListItem>
                  );
                })}
              </List>
            </Collapse>

            {/* Меню чата в проекте — тот же стиль, что в Sidebar */}
            <Popover
              open={Boolean(chatMenuAnchor)}
              anchorEl={chatMenuAnchor}
              onClose={handleChatMenuClose}
              anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
              transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              slotProps={{
                paper: {
                  sx: {
                    mt: 0.5,
                    p: 0,
                    overflow: 'visible',
                    background: 'transparent !important',
                    backgroundColor: 'transparent !important',
                    boxShadow: 'none !important',
                    border: 'none',
                  },
                },
              }}
            >
              <Box sx={{ ...dropdownPanelSx, width: MENU_COMPACT_PANEL_WIDTH_PX, display: 'flex', flexDirection: 'column' }}>
                <Box sx={{ py: 0.5, px: 0.5 }}>
                  <Box
                    onClick={() => handleChatMenuAction('pin')}
                    sx={{ ...dropdownItemSx, display: 'flex', alignItems: 'center', gap: 1, color: theme.palette.mode === 'dark' ? 'white' : '#333' }}
                  >
                    <PushPinIcon sx={{ fontSize: 18, color: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)', flexShrink: 0 }} />
                    <Typography sx={{ flex: 1, fontSize: MENU_ACTION_TEXT_SIZE }}>
                      {selectedChatId && getChatById(selectedChatId)?.isPinnedInProject ? 'Открепить' : 'Пин'}
                    </Typography>
                  </Box>

                  <Box
                    onClick={() => handleChatMenuAction('rename')}
                    sx={{ ...dropdownItemSx, display: 'flex', alignItems: 'center', gap: 1, color: theme.palette.mode === 'dark' ? 'white' : '#333' }}
                  >
                    <EditIcon sx={{ fontSize: 18, color: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)', flexShrink: 0 }} />
                    <Typography sx={{ flex: 1, fontSize: MENU_ACTION_TEXT_SIZE }}>Переименовать</Typography>
                  </Box>

                  <Box
                    onClick={() => handleChatMenuAction('archive')}
                    sx={{ ...dropdownItemSx, display: 'flex', alignItems: 'center', gap: 1, color: theme.palette.mode === 'dark' ? 'white' : '#333' }}
                  >
                    <ArchiveIcon sx={{ fontSize: 18, color: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)', flexShrink: 0 }} />
                    <Typography sx={{ flex: 1, fontSize: MENU_ACTION_TEXT_SIZE }}>Архив</Typography>
                  </Box>

                  {selectedChatId && getChatById(selectedChatId)?.projectId && (
                    <Box
                      onClick={() => handleChatMenuAction('removeFromProject')}
                      sx={{ ...dropdownItemSx, display: 'flex', alignItems: 'center', gap: 1, color: theme.palette.mode === 'dark' ? 'white' : '#333' }}
                    >
                      <FolderIcon sx={{ fontSize: 18, color: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)', flexShrink: 0 }} />
                      <Typography sx={{ flex: 1, fontSize: MENU_ACTION_TEXT_SIZE }}>Перенести из проекта</Typography>
                    </Box>
                  )}

                  <Divider sx={{ my: 0.5, borderColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }} />

                  <Box
                    onClick={() => handleChatMenuAction('delete')}
                    sx={{
                      ...dropdownItemSx,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      color: '#d32f2f',
                      '&:hover': { backgroundColor: 'rgba(211, 47, 47, 0.1)' },
                    }}
                  >
                    <DeleteIcon sx={{ fontSize: 18, color: '#d32f2f', flexShrink: 0 }} />
                    <Typography sx={{ flex: 1, fontSize: MENU_ACTION_TEXT_SIZE, color: '#d32f2f' }}>Удалить</Typography>
                  </Box>
                </Box>
              </Box>
            </Popover>

          </Box>
        )}

        {/* Инструменты — как на странице чата: Агенты + БЗ + очистка поля */}
        <Popover
          open={Boolean(anchorEl)}
          anchorEl={anchorEl}
          action={gearToolsPopoverActionRef}
          onClose={handleMenuClose}
          anchorOrigin={{ vertical: CHAT_GEAR_MENU_ANCHOR_VERTICAL_OFFSET, horizontal: 'left' }}
          transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          marginThreshold={CHAT_GEAR_MENU_MARGIN_THRESHOLD_PX}
          slotProps={{
            paper: {
              sx: {
                mt: 0,
                mb: 0,
                p: 0,
                overflowX: 'hidden',
                background: 'transparent !important',
                backgroundColor: 'transparent !important',
                boxShadow: 'none !important',
                border: 'none',
                ...(gearToolsPaperHeightPx != null
                  ? {
                      minHeight: `${gearToolsPaperHeightPx}px`,
                      maxHeight: `${gearToolsPaperHeightPx}px`,
                      height: `${gearToolsPaperHeightPx}px`,
                      overflowY:
                        gearToolsPaperHeightPx < CHAT_GEAR_MENU_PAPER_MAX_HEIGHT_PX ? 'auto' : 'hidden',
                    }
                  : { maxHeight: CHAT_GEAR_MENU_PAPER_MAX_HEIGHT, overflowY: 'auto' }),
                ...((gearToolsPanel === 'agents' || gearToolsPanel === 'skills' || gearToolsPanel === 'model-mode' || gearToolsPanel === 'mcp' || gearToolsPanel === 'coding')
                  ? CHAT_GEAR_SCROLL_AREA_NO_VISIBLE_SCROLLBAR_SX
                  : {}),
              },
            },
          }}
        >
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'stretch',
              gap: gearToolsPanel === 'agents' || gearToolsPanel === 'skills' || gearToolsPanel === 'model-mode' || gearToolsPanel === 'mcp' || gearToolsPanel === 'coding' ? `${CHAT_GEAR_MENU_PANELS_GAP_PX}px` : 0,
              width:
                (gearToolsPanel === 'agents' || gearToolsPanel === 'skills' || gearToolsPanel === 'model-mode' || gearToolsPanel === 'mcp' || gearToolsPanel === 'coding') && gearToolsMenuWidthPx != null
                  ? `${gearToolsMenuWidthPx}px`
                  : gearToolsPanel === 'agents' || gearToolsPanel === 'skills' || gearToolsPanel === 'model-mode' || gearToolsPanel === 'mcp' || gearToolsPanel === 'coding'
                    ? CHAT_GEAR_MENU_EXPANDED_WIDTH_PX
                    : CHAT_GEAR_MENU_PANEL_WIDTH_PX,
              maxWidth:
                (gearToolsPanel === 'agents' || gearToolsPanel === 'skills' || gearToolsPanel === 'model-mode' || gearToolsPanel === 'mcp' || gearToolsPanel === 'coding') && gearToolsMenuWidthPx != null
                  ? `${gearToolsMenuWidthPx}px`
                  : 'min(96vw, 580px)',
              minHeight: gearToolsPaperHeightPx != null ? `${gearToolsPaperHeightPx}px` : undefined,
              height: gearToolsPaperHeightPx != null ? `${gearToolsPaperHeightPx}px` : undefined,
              maxHeight: gearToolsPaperHeightPx != null ? `${gearToolsPaperHeightPx}px` : 'inherit',
              boxSizing: 'border-box',
              overflow: 'hidden',
            }}
          >
            <Box
              sx={{
                ...dropdownPanelSx,
                width:
                  gearToolsPanel === 'agents' || gearToolsPanel === 'skills' || gearToolsPanel === 'model-mode' || gearToolsPanel === 'mcp' || gearToolsPanel === 'coding'
                    ? CHAT_GEAR_MENU_LEFT_RAIL_WIDTH_PX
                    : '100%',
                flexShrink: 0,
                boxSizing: 'border-box',
                py: 0.5,
                px: 0.5,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-start',
                alignSelf: 'stretch',
                minHeight: 0,
                height: '100%',
              }}
            >
              <Box
                onClick={() => setGearToolsPanel((p) => (p === 'agents' ? 'main' : 'agents'))}
                sx={{
                  ...dropdownItemSx,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  color: isDarkMode ? 'white' : '#333',
                  bgcolor:
                    gearToolsPanel === 'agents'
                      ? isDarkMode
                        ? DROPDOWN_ITEM_HOVER_BG_DARK
                        : DROPDOWN_ITEM_HOVER_BG_LIGHT
                      : 'transparent',
                }}
              >
                <GearMenuAgentsIcon
                  sx={{ fontSize: 18, color: isDarkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)', flexShrink: 0 }}
                />
                <Typography sx={{ flex: 1, minWidth: 0, fontSize: MENU_ACTION_TEXT_SIZE, whiteSpace: 'nowrap' }}>
                  Агенты
                </Typography>
                <ChevronRightIcon
                  sx={{
                    ...DROPDOWN_CHEVRON_SX,
                    flexShrink: 0,
                    transform: gearToolsPanel === 'agents' ? 'rotate(90deg)' : 'none',
                  }}
                />
              </Box>
                          <Box
              onClick={() => setGearToolsPanel((p) => (p === 'skills' ? 'main' : 'skills'))}
              sx={{
                ...dropdownItemSx,
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                color: isDarkMode ? 'white' : '#333',
                bgcolor:
                  gearToolsPanel === 'skills'
                    ? isDarkMode
                      ? DROPDOWN_ITEM_HOVER_BG_DARK
                      : DROPDOWN_ITEM_HOVER_BG_LIGHT
                    : 'transparent',
              }}
            >
              <SkillsNavIcon
                sx={{ fontSize: 18, color: isDarkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)', flexShrink: 0 }}
              />
              <Typography sx={{ flex: 1, minWidth: 0, fontSize: MENU_ACTION_TEXT_SIZE, whiteSpace: 'nowrap' }}>
                Skills
              </Typography>
              <ChevronRightIcon
                sx={{
                  ...DROPDOWN_CHEVRON_SX,
                  flexShrink: 0,
                  transform: gearToolsPanel === 'skills' ? 'rotate(90deg)' : 'none',
                }}
              />
            </Box>
<Box
                onClick={() => setGearToolsPanel((p) => (p === 'mcp' ? 'main' : 'mcp'))}
                sx={{
                  ...dropdownItemSx,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  color: isDarkMode ? 'white' : '#333',
                  bgcolor:
                    gearToolsPanel === 'mcp'
                      ? isDarkMode
                        ? DROPDOWN_ITEM_HOVER_BG_DARK
                        : DROPDOWN_ITEM_HOVER_BG_LIGHT
                      : 'transparent',
                }}
              >
                <GearMenuMcpIcon
                  sx={{ fontSize: 18, color: isDarkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)', flexShrink: 0 }}
                />
                <Typography sx={{ flex: 1, minWidth: 0, fontSize: MENU_ACTION_TEXT_SIZE, whiteSpace: 'nowrap' }}>
                  MCP
                </Typography>
                <ChevronRightIcon
                  sx={{
                    ...DROPDOWN_CHEVRON_SX,
                    flexShrink: 0,
                    transform: gearToolsPanel === 'mcp' ? 'rotate(90deg)' : 'none',
                  }}
                />
              </Box>
              <Box
                onClick={() => {
                  setGearToolsPanel((p) => {
                    const next = p === 'coding' ? 'main' : 'coding';
                    if (next === 'coding') {
                      enableCodingFromGearPanel(selectedChatId);
                    }
                    return next;
                  });
                }}
                sx={{
                  ...dropdownItemSx,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  color: isDarkMode ? 'white' : '#333',
                  bgcolor:
                    gearToolsPanel === 'coding'
                      ? isDarkMode
                        ? DROPDOWN_ITEM_HOVER_BG_DARK
                        : DROPDOWN_ITEM_HOVER_BG_LIGHT
                      : 'transparent',
                }}
              >
                <GearMenuCodingIcon
                  sx={{ fontSize: 18, color: isDarkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)', flexShrink: 0 }}
                />
                <Typography sx={{ flex: 1, minWidth: 0, fontSize: MENU_ACTION_TEXT_SIZE, whiteSpace: 'nowrap' }}>
                  Coding
                </Typography>
                <ChevronRightIcon
                  sx={{
                    ...DROPDOWN_CHEVRON_SX,
                    flexShrink: 0,
                    transform: gearToolsPanel === 'coding' ? 'rotate(90deg)' : 'none',
                  }}
                />
              </Box>
              <Box
                onClick={() => setGearToolsPanel((p) => (p === 'model-mode' ? 'main' : 'model-mode'))}
                sx={{
                  ...dropdownItemSx,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  color: isDarkMode ? 'white' : '#333',
                  bgcolor:
                    gearToolsPanel === 'model-mode'
                      ? isDarkMode
                        ? DROPDOWN_ITEM_HOVER_BG_DARK
                        : DROPDOWN_ITEM_HOVER_BG_LIGHT
                      : 'transparent',
                }}
              >
                <ThinkingModeIcon
                  sx={{ fontSize: 18, color: isDarkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)', flexShrink: 0 }}
                />
                <Typography sx={{ flex: 1, minWidth: 0, fontSize: MENU_ACTION_TEXT_SIZE, whiteSpace: 'nowrap' }}>
                  Режим модели
                </Typography>
                <ChevronRightIcon
                  sx={{
                    ...DROPDOWN_CHEVRON_SX,
                    flexShrink: 0,
                    transform: gearToolsPanel === 'model-mode' ? 'rotate(90deg)' : 'none',
                  }}
                />
              </Box>
              <Tooltip
                title={!memoryRagEnabled ? MEMORY_RAG_DISABLED_HINT : ''}
                disableHoverListener={memoryRagEnabled}
              >
                <span style={{ display: 'block' }}>
                  <Box
                    onClick={() => {
                      if (!memoryRagEnabled) return;
                      toggleKbRag();
                      handleMenuClose();
                    }}
                    sx={{
                      ...dropdownItemSx,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      color: isDarkMode ? 'white' : '#333',
                      opacity: memoryRagEnabled ? 1 : 0.5,
                      cursor: memoryRagEnabled ? 'pointer' : 'not-allowed',
                    }}
                  >
                    <KbIcon sx={{ fontSize: 18, color: isDarkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)', flexShrink: 0 }} />
                    <Typography sx={{ flex: 1, minWidth: 0, fontSize: MENU_ACTION_TEXT_SIZE, whiteSpace: 'nowrap' }}>
                      {useKbRag ? 'Отключить общий RAG' : 'Общий RAG'}
                    </Typography>
                    {useKbRag ? (
                      <CheckIcon sx={{ fontSize: 16, color: 'primary.main', flexShrink: 0 }} />
                    ) : null}
                  </Box>
                </span>
              </Tooltip>
              <Box
                onClick={() => {
                  setInputMessage('');
                  handleMenuClose();
                }}
                sx={{
                  ...dropdownItemSx,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  color: isDarkMode ? 'white' : '#333',
                }}
              >
                <ClearIcon sx={{ fontSize: 18, color: isDarkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)', flexShrink: 0 }} />
                <Typography sx={{ flex: 1, minWidth: 0, fontSize: MENU_ACTION_TEXT_SIZE, whiteSpace: 'nowrap' }}>
                  Очистить поле ввода
                </Typography>
              </Box>
            </Box>
            {gearToolsPanel === 'agents' || gearToolsPanel === 'skills' || gearToolsPanel === 'model-mode' || gearToolsPanel === 'mcp' || gearToolsPanel === 'coding' ? (
              <Box
                sx={{
                  ...dropdownPanelSx,
                  flex: 1,
                  minWidth: `${CHAT_GEAR_MENU_AGENTS_RIGHT_MIN_PX}px`,
                  minHeight: 0,
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                {gearToolsPanel === 'agents' ? (
                  <ChatGearAgentsPanel isDarkMode={isDarkMode} />
                ) : gearToolsPanel === 'skills' ? (
                <ChatGearSkillsPanel isDarkMode={isDarkMode} />
              ) : gearToolsPanel === 'mcp' ? (
                  <ChatGearMcpPanel isDarkMode={isDarkMode} chatId={mcpScopeChatId} />
                ) : gearToolsPanel === 'coding' ? (
                  <ChatGearCodingPanel
                    isDarkMode={isDarkMode}
                    chatId={mcpScopeChatId}
                    projectId={projectId}
                  />
                ) : (
                  <Box sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 0.5, overflowY: 'auto' }}>
                    {([
                      { id: 'auto', label: 'Автоматический', icon: <AutoModeIcon sx={{ fontSize: 16 }} /> },
                      { id: 'thinking', label: 'Мышление', icon: <ThinkingModeIcon sx={{ fontSize: 16 }} /> },
                      { id: 'fast', label: 'Быстрый', icon: <FastModeIcon sx={{ fontSize: 16 }} /> },
                    ] as const).map((mode) => (
                      <Box
                        key={mode.id}
                        onClick={() => {
                          setModelThinkingMode(mode.id);
                        }}
                        sx={{
                          ...dropdownItemSx,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1,
                          color: isDarkMode ? 'white' : '#333',
                          bgcolor:
                            modelThinkingMode === mode.id
                              ? isDarkMode
                                ? DROPDOWN_ITEM_HOVER_BG_DARK
                                : DROPDOWN_ITEM_HOVER_BG_LIGHT
                              : 'transparent',
                        }}
                      >
                        <Box sx={{ display: 'inline-flex', opacity: 0.9 }}>{mode.icon}</Box>
                        <Typography sx={{ flex: 1, minWidth: 0, fontSize: MENU_ACTION_TEXT_SIZE }}>
                          {mode.label}
                        </Typography>
                        {modelThinkingMode === mode.id ? (
                          <CheckIcon sx={{ fontSize: 16, color: 'primary.main', flexShrink: 0 }} />
                        ) : null}
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
            ) : null}
          </Box>
        </Popover>

        <VoiceChatDialog
          open={showVoiceDialog}
          onClose={() => setShowVoiceDialog(false)}
        />

        <TranscriptionResultModal
          open={transcriptionModalOpen}
          onClose={() => setTranscriptionModalOpen(false)}
          transcriptionResult={transcriptionResult}
          onResultChange={(text) => setTranscriptionResult(text)}
          onInsertToChat={(text) => {
            setInputMessage(text);
            setTimeout(() => inputRef.current?.focus(), 100);
          }}
        />

        {/* Диалог подтверждения удаления (как в сайдбаре) */}
        <Dialog
          open={showDeleteDialog}
          onClose={() => setShowDeleteDialog(false)}
          maxWidth="sm"
          fullWidth
          PaperProps={{
            sx: {
              backgroundColor: theme.palette.mode === 'dark' ? '#1e1e1e' : '#ffffff',
              color: theme.palette.mode === 'dark' ? 'white' : '#333',
              borderRadius: 2,
            },
          }}
        >
          <DialogTitle sx={{ color: theme.palette.mode === 'dark' ? 'white' : '#333', fontWeight: 'bold' }}>
            Удалить чат
          </DialogTitle>
          <DialogContent>
            <Typography sx={{ color: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.8)', mt: 1 }}>
              Это действие навсегда удалит выбранный чат и не может быть отменено.
              Пожалуйста, подтвердите для продолжения.
            </Typography>
          </DialogContent>
          <DialogActions sx={{ p: 2, gap: 1 }}>
            <Button
              onClick={() => setShowDeleteDialog(false)}
              sx={{
                backgroundColor: theme.palette.mode === 'dark' ? 'black' : 'rgba(0,0,0,0.08)',
                color: theme.palette.mode === 'dark' ? 'white' : '#333',
                '&:hover': { backgroundColor: theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.8)' : 'rgba(0,0,0,0.12)' },
                textTransform: 'none',
                px: 3,
              }}
            >
              Отменить
            </Button>
            <Button
              onClick={handleConfirmDelete}
              sx={{
                backgroundColor: '#d32f2f',
                color: 'white',
                '&:hover': { backgroundColor: '#b71c1c' },
                textTransform: 'none',
                px: 3,
              }}
            >
              Удалить
            </Button>
          </DialogActions>
        </Dialog>
      </Box>

      {/* Правый сайдбар (как на странице чата) */}
      {!rightSidebarHidden && (
        <Drawer
          variant="persistent"
          anchor="right"
          open={true}
          slotProps={{ paper: { className: 'astra-right-rail' } }}
          sx={{
            width: rightSidebarOpen ? 240 : 64,
            flexShrink: 0,
            transition: 'width 0.3s ease',
            '& .MuiDrawer-paper': {
              width: rightSidebarOpen ? 240 : 64,
              boxSizing: 'border-box',
              ...getSidebarChromeSx(rightSidebarPanelBg),
              ...getSidebarForcedContrastSx(rightSidebarPanelBg),
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
          {!rightSidebarOpen && (
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
                    onClick={() => setRightSidebarOpen(true)}
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
                          setRightSidebarOpen(true);
                          setTranscriptionMenuOpen(true);
                        }}
                        sx={getSidebarRailCollapsedListItemButtonSx(isSidebarPanelLight(rightSidebarPanelBg))}
                      >
                        <SidebarRailTranscribeIcon sx={SIDEBAR_LIST_ICON_SX} />
                      </ListItemButton>
                    </Box>
                  </Tooltip>
                </ListItem>
                <GalleryNavButton variant="collapsed" isDarkMode={isDarkMode} panelIsLight={isSidebarPanelLight(rightSidebarPanelBg)} />
                <ListItem disablePadding sx={{ mb: 0.5, display: 'block' }}>
                  <Tooltip title="Skills" placement="left">
                    <Box component="span" sx={{ display: 'flex', width: '100%', justifyContent: 'center' }}>
                      <ListItemButton
                        onClick={() => navigate('/skills')}
                        sx={getSidebarRailCollapsedListItemButtonSx(isSidebarPanelLight(rightSidebarPanelBg))}
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
                          setRightSidebarOpen(true);
                          setAgentConstructorOpen(true);
                        }}
                        sx={getSidebarRailCollapsedListItemButtonSx(isSidebarPanelLight(rightSidebarPanelBg))}
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
                  alignItems: 'center',
                  zIndex: 1200,
                }}
              >
                <Tooltip title="Скрыть панель" placement="left">
                  <IconButton
                    onClick={() => startTransition(() => setRightSidebarHidden(true))}
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

          {rightSidebarOpen && (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                overflow: 'hidden',
                // См. UnifiedChatPage: при анимации ширины drawer подписи не должны пересчитываться по узкой полосе.
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
                    onClick={() => setRightSidebarOpen(false)}
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
                    onClick={() => setTranscriptionMenuOpen(prev => !prev)}
                    sx={{
                      ...SIDEBAR_CHAT_ROW_LIST_ITEM_BUTTON_SX,
                      color: 'white',
                      backgroundColor: transcriptionMenuOpen ? 'rgba(255,255,255,0.15)' : 'transparent',
                      '&:hover': {
                        backgroundColor: transcriptionMenuOpen ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)',
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
                {transcriptionMenuOpen && (
                  <Box sx={{ borderTop: '1px solid rgba(255,255,255,0.08)', p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <input
                      ref={transcriptionFileInputRef}
                      type="file"
                      accept="audio/*,video/*"
                      hidden
                      onChange={handleTranscriptionFileSelect}
                    />
                    {isTranscribing && (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.78rem' }}>
                          Транскрибация идёт...
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                          <CircularProgress size={16} sx={{ color: 'primary.main' }} />
                          <Button
                            size="small"
                            startIcon={<SquareIcon sx={{ fontSize: '0.75rem' }} />}
                            onClick={handleStopTranscriptionFromSidebar}
                            disabled={!transcriptionId}
                            sx={{
                              fontSize: '0.7rem',
                              textTransform: 'none',
                              color: 'rgba(255,255,255,0.7)',
                              py: 0.5,
                              minWidth: 0,
                              '&:hover': { bgcolor: 'rgba(255,255,255,0.08)' },
                            }}
                          >
                            Остановить
                          </Button>
                        </Box>
                      </Box>
                    )}
                    {transcriptionResult && !isTranscribing && (
                      <Button
                        size="small"
                        fullWidth
                        variant="outlined"
                        onClick={() => setTranscriptionModalOpen(true)}
                        sx={{
                          fontSize: '0.78rem',
                          textTransform: 'none',
                          color: 'primary.main',
                          borderColor: 'primary.main',
                          py: 0.75,
                          '&:hover': { borderColor: 'primary.light', bgcolor: 'rgba(33,150,243,0.08)' },
                        }}
                      >
                        Посмотреть результат
                      </Button>
                    )}
                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.7rem', display: 'block', lineHeight: 1.35 }}>
                      Форматы: MP3, WAV, M4A, AAC, FLAC, MP4, AVI, MOV, MKV, WebM
                      <br />
                      Максимальный размер: 5GB
                    </Typography>
                    <Button
                      size="small"
                      fullWidth
                      startIcon={<UploadIcon sx={{ fontSize: '0.85rem !important' }} />}
                      onClick={() => transcriptionFileInputRef.current?.click()}
                      disabled={isTranscribing}
                      sx={{
                        fontSize: '0.72rem',
                        textTransform: 'none',
                        color: 'rgba(255,255,255,0.6)',
                        border: '1px dashed rgba(255,255,255,0.2)',
                        py: 0.75,
                        justifyContent: 'flex-start',
                        '&:hover': { bgcolor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.35)' },
                        '&:disabled': { color: 'rgba(255,255,255,0.35)', borderColor: 'rgba(255,255,255,0.1)' },
                      }}
                    >
                      Загрузить файл
                    </Button>
                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.7rem', display: 'block', mt: 0.5 }}>
                      Вставить ссылку на ютуб
                    </Typography>
                    <TextField
                      size="small"
                      fullWidth
                      placeholder="https://www.youtube.com/watch?v=..."
                      value={transcriptionYoutubeUrl}
                      onChange={(e) => setTranscriptionYoutubeUrl(e.target.value)}
                      disabled={isTranscribing}
                      sx={{
                        '& .MuiOutlinedInput-root': {
                          fontSize: '0.78rem',
                          bgcolor: 'rgba(255,255,255,0.06)',
                          color: 'rgba(255,255,255,0.9)',
                          borderColor: 'rgba(255,255,255,0.2)',
                          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.35)' },
                          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'primary.main' },
                        },
                        '& .MuiInputBase-input::placeholder': { color: 'rgba(255,255,255,0.4)', opacity: 1 },
                      }}
                    />
                    <Button
                      size="small"
                      fullWidth
                      startIcon={<YouTubeIcon sx={{ fontSize: '0.85rem !important' }} />}
                      onClick={startYouTubeTranscriptionFromSidebar}
                      disabled={!transcriptionYoutubeUrl.trim() || isTranscribing}
                      sx={{
                        fontSize: '0.72rem',
                        textTransform: 'none',
                        color: 'rgba(255,255,255,0.9)',
                        bgcolor: 'rgba(255,255,255,0.08)',
                        py: 0.65,
                        '&:hover': { bgcolor: 'rgba(255,255,255,0.12)' },
                        '&:disabled': { color: 'rgba(255,255,255,0.4)' },
                      }}
                    >
                      Транскрибировать
                    </Button>
                  </Box>
                )}

                <GalleryNavButton variant="expanded" isDarkMode={isDarkMode} panelIsLight={isSidebarPanelLight(rightSidebarPanelBg)} />

                <ListItem disablePadding sx={{ mb: 0.5 }}>
                  <ListItemButton
                    onClick={() => navigate('/skills')}
                    sx={{
                      ...SIDEBAR_CHAT_ROW_LIST_ITEM_BUTTON_SX,
                      color: 'white',
                      '&:hover': {
                        backgroundColor: 'rgba(255,255,255,0.08)',
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

                <ListItem disablePadding sx={{ mb: 0.5 }}>
                  <ListItemButton
                    onClick={() => setAgentConstructorOpen((prev) => !prev)}
                    sx={{
                      ...SIDEBAR_CHAT_ROW_LIST_ITEM_BUTTON_SX,
                      color: 'white',
                      backgroundColor: agentConstructorOpen ? 'rgba(255,255,255,0.15)' : 'transparent',
                      '&:hover': {
                        backgroundColor: agentConstructorOpen ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)',
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

      {rightSidebarHidden && (
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
              onClick={() => {
                startTransition(() => {
                  setRightSidebarHidden(false);
                  setRightSidebarOpen(false);
                });
              }}
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
    </Box>
  );
}
