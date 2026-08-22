import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  IconButton,
  LinearProgress,
  Alert,
  Chip,
  Tooltip,
  Button,
} from '@mui/material';
import {
  CloudUpload as UploadIcon,
  Delete as DeleteIcon,
  Description as DocumentIcon,
  PictureAsPdf as PdfIcon,
  TableChart as ExcelIcon,
  TextSnippet as TxtIcon,
  Article as ArticleIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { getApiUrl, API_ENDPOINTS, getAuthFetchHeaders } from '../config/api';
import {
  fetchRagEntityDefaults,
  resolveRagEmbeddingModelPath,
  resolveRagRerankerModelPath,
} from '../constants/ragEntityDefaults';
import { useRagEntityReadyMessage } from '../hooks/useRagEntityReadyMessage';
import { ragDocumentDisplayIndex } from '../utils/ragDocumentDisplayIndex';
import RagUploadingFileThumb from './RagUploadingFileThumb';
import {
  commitRagUploadUiUpdate,
  createRagPendingUploads,
  getRagFileTypeLabel,
  mapWithConcurrency,
  mergeRagDocumentsById,
  parseRagUploadDocumentId,
  removeRagPendingUploads,
  RAG_UPLOAD_CONCURRENCY,
  type RagPendingUpload,
} from '../utils/ragPendingUpload';

export interface ProjectRagDoc {
  id: number;
  filename: string;
  created_at: string | null;
  size?: number | null;
  file_type?: string | null;
}

function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || !bytes) return '—';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function getFileIcon(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return <PdfIcon sx={{ color: '#e53935' }} />;
  if (['xlsx', 'xls', 'csv'].includes(ext)) return <ExcelIcon sx={{ color: '#43a047' }} />;
  if (ext === 'txt' || ext === 'md') return <TxtIcon sx={{ color: '#1e88e5' }} />;
  if (['docx', 'doc'].includes(ext)) return <ArticleIcon sx={{ color: '#1565c0' }} />;
  return <DocumentIcon sx={{ color: '#7b1fa2' }} />;
}

const ALLOWED = ['.pdf', '.docx', '.doc', '.docm', '.xlsx', '.xls', '.xlsm', '.txt', '.csv', '.md', '.log', '.rtf'];

export interface ProjectRagLibraryInlineProps {
  /** null — до первого resolve (новый проект) */
  projectId: string | null;
  /** Вызывается перед первой загрузкой, если projectId ещё null; должен вернуть id проекта */
  onResolveProjectId?: () => string | Promise<string>;
  /** Загружать список при монтировании / смене id */
  autoLoad?: boolean;
  /** Подпись под заголовком */
  subtitle?: string;
  dense?: boolean;
}

export default function ProjectRagLibraryInline({
  projectId,
  onResolveProjectId,
  autoLoad = true,
  subtitle = 'Оригиналы в MinIO, чанки и векторы — в PostgreSQL (только этот проект)',
  dense = false,
}: ProjectRagLibraryInlineProps) {
  const [documents, setDocuments] = useState<ProjectRagDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingUploads, setPendingUploads] = useState<RagPendingUpload[]>([]);
  const [banner, setBanner] = useState<{
    message: string;
    severity: 'success' | 'error' | 'info' | 'warning';
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [resolvedId, setResolvedId] = useState<string | null>(projectId);

  useEffect(() => {
    setResolvedId(projectId);
  }, [projectId]);

  const effectiveId = resolvedId ?? projectId;

  const { readyMessage: ragReadyMessage, clearReadyMessage: clearRagReadyMessage } =
    useRagEntityReadyMessage('project', effectiveId);

  const showModelGuard = useCallback((message: string) => {
    setBanner({ message, severity: 'warning' });
  }, []);

  /** Модели из настроек проекта (уже сохранённых в БД). */
  const resolveProjectRagModelPaths = useCallback(
    async (
      pid: string,
    ): Promise<{
      embeddingPath: string;
      rerankerPath: string;
      rerankingEnabled: boolean;
    }> => {
      try {
        const resp = await fetch(
          getApiUrl(`/api/rag/settings?scope=project&project_id=${encodeURIComponent(pid)}`),
          { headers: getAuthFetchHeaders() },
        );
        if (!resp.ok) {
          const envDefaults = await fetchRagEntityDefaults('project');
          return {
            embeddingPath: envDefaults.embeddingPath,
            rerankerPath: envDefaults.rerankerPath,
            rerankingEnabled: true,
          };
        }
        const data = (await resp.json()) as Record<string, unknown>;
        const envDefaults = await fetchRagEntityDefaults('project');
        return {
          embeddingPath: resolveRagEmbeddingModelPath(
            String(data.rag_embedding_model_path || ''),
            envDefaults.embeddingPath,
          ),
          rerankerPath: resolveRagRerankerModelPath(
            String(data.rag_reranker_model_path || ''),
            envDefaults.rerankerPath,
          ),
          rerankingEnabled:
            typeof data.rag_reranking_enabled === 'boolean'
              ? data.rag_reranking_enabled
              : true,
        };
      } catch {
        const envDefaults = await fetchRagEntityDefaults('project');
        return {
          embeddingPath: envDefaults.embeddingPath,
          rerankerPath: envDefaults.rerankerPath,
          rerankingEnabled: true,
        };
      }
    },
    [],
  );

  const fetchList = useCallback(async (pid: string): Promise<ProjectRagDoc[]> => {
    const url = getApiUrl((API_ENDPOINTS.PROJECT_RAG_LIST as (id: string) => string)(pid));
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    return data.documents || [];
  }, []);

  const loadDocuments = useCallback(async () => {
    if (!effectiveId) {
      setDocuments([]);
      return;
    }
    setLoading(true);
    setBanner(null);
    try {
      setDocuments(await fetchList(effectiveId));
    } catch (e) {
      setBanner({
        message: `Не удалось загрузить список файлов: ${e instanceof Error ? e.message : String(e)}`,
        severity: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [effectiveId, fetchList]);

  useEffect(() => {
    if (!autoLoad) return;
    if (!effectiveId) {
      setDocuments([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchList(effectiveId)
      .then((docs) => {
        if (!cancelled) setDocuments(docs);
      })
      .catch(() => {
        if (!cancelled) setDocuments([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveId, autoLoad, fetchList]);

  const ensureProjectId = async (): Promise<string | null> => {
    if (effectiveId) return effectiveId;
    if (!onResolveProjectId) {
      setBanner({
        message: 'Загрузка файлов для этого экрана недоступна (не передан обработчик создания проекта).',
        severity: 'error',
      });
      return null;
    }
    try {
      const id = await Promise.resolve(onResolveProjectId());
      setResolvedId(id);
      return id;
    } catch (e) {
      setBanner({
        message: `Не удалось подготовить проект: ${e instanceof Error ? e.message : String(e)}`,
        severity: 'error',
      });
      return null;
    }
  };

  const uploadFiles = async (files: FileList | File[]) => {
    // Снимок ДО любых await: FileList живой и обнуляется с value input.
    const list = Array.from(files || []);
    if (!list.length) return;

    const valid = list.filter((f) => {
      const ext = '.' + f.name.split('.').pop()?.toLowerCase();
      return ALLOWED.includes(ext);
    });
    if (!valid.length) {
      setBanner({
        message: 'Допустимы: PDF, DOC/DOCX/DOCM, XLS/XLSX/XLSM, TXT, MD, LOG, CSV, RTF',
        severity: 'error',
      });
      return;
    }

    const pendingEntries = createRagPendingUploads(valid);
    const dropPending = (ids: string[]) => {
      setPendingUploads((prev) => removeRagPendingUploads(prev, ids));
    };

    const pid = await ensureProjectId();
    if (!pid) {
      dropPending(pendingEntries.map((entry) => entry.clientId));
      return;
    }

    const { embeddingPath, rerankerPath, rerankingEnabled } =
      await resolveProjectRagModelPaths(pid);
    if (!embeddingPath) {
      dropPending(pendingEntries.map((entry) => entry.clientId));
      showModelGuard(
        'Сначала выберите модель эмбеддингов в настройках РАГ для проекта',
      );
      return;
    }
    if (rerankingEnabled && !rerankerPath) {
      dropPending(pendingEntries.map((entry) => entry.clientId));
      showModelGuard(
        'Сначала выберите модель реранкера в настройках РАГ для проекта',
      );
      return;
    }

    setUploading(true);
    setBanner(null);
    setPendingUploads((prev) => [...prev, ...pendingEntries]);

    let stopRemaining = false;
    let successCount = 0;

    await mapWithConcurrency(valid, RAG_UPLOAD_CONCURRENCY, async (file, index) => {
      if (stopRemaining) {
        const pendingId = pendingEntries[index]?.clientId;
        if (pendingId) {
          commitRagUploadUiUpdate(() => {
            setPendingUploads((prev) => removeRagPendingUploads(prev, [pendingId]));
          });
        }
        return;
      }

      const pendingId = pendingEntries[index]?.clientId;
      try {
        const fd = new FormData();
        fd.append('file', file);
        const url = getApiUrl((API_ENDPOINTS.PROJECT_RAG_UPLOAD as (id: string) => string)(pid));
        const resp = await fetch(url, { method: 'POST', headers: getAuthFetchHeaders(), body: fd });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ detail: resp.statusText }));
          const detail = err.detail;
          const msg =
            typeof detail === 'string'
              ? detail
              : Array.isArray(detail)
                ? detail
                    .map((d: unknown) =>
                      typeof d === 'object' && d && 'msg' in d
                        ? String((d as { msg: unknown }).msg)
                        : String(d),
                    )
                    .join('; ')
                : JSON.stringify(detail);
          // Сообщения про модели — оранжевая табличка, остальное error.
          if (
            typeof msg === 'string' &&
            (msg.includes('эмбеддинг') || msg.includes('реранкер'))
          ) {
            showModelGuard(msg);
          } else {
            setBanner({ message: `${file.name}: ${msg}`, severity: 'error' });
          }
          stopRemaining = true;
          if (pendingId) {
            commitRagUploadUiUpdate(() => {
              setPendingUploads((prev) => removeRagPendingUploads(prev, [pendingId]));
            });
          }
          return;
        }
        const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
        const docId = parseRagUploadDocumentId(data);
        successCount += 1;
        commitRagUploadUiUpdate(() => {
          if (docId != null) {
            setDocuments((prev) => {
              if (prev.some((d) => d.id === docId)) return prev;
              return [
                {
                  id: docId,
                  filename: file.name,
                  size: file.size,
                  file_type: getRagFileTypeLabel(file.name),
                  created_at: new Date().toISOString(),
                },
                ...prev,
              ];
            });
          }
          if (pendingId) {
            setPendingUploads((prev) => removeRagPendingUploads(prev, [pendingId]));
          }
        });
        if (docId == null) {
          try {
            const fresh = await fetchList(pid);
            commitRagUploadUiUpdate(() => {
              setDocuments((prev) => mergeRagDocumentsById(prev, fresh));
            });
          } catch {
            /* ignore */
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setBanner({ message: `${file.name}: ${msg}`, severity: 'error' });
        stopRemaining = true;
        if (pendingId) {
          commitRagUploadUiUpdate(() => {
            setPendingUploads((prev) => removeRagPendingUploads(prev, [pendingId]));
          });
        }
      }
    });

    setUploading(false);
    if (stopRemaining) {
      try {
        setDocuments(await fetchList(pid));
      } catch {
        /* ignore */
      }
      commitRagUploadUiUpdate(() => {
        setPendingUploads([]);
      });
      return;
    }
    setBanner({
      message: `Загружено файлов: ${successCount || valid.length}. Документы проиндексированы для RAG.`,
      severity: 'success',
    });
    void fetchList(pid)
      .then((fresh) => {
        setDocuments((prev) => mergeRagDocumentsById(prev, fresh));
      })
      .catch(() => undefined);
  };

  const handleDelete = async (doc: ProjectRagDoc) => {
    if (!effectiveId) return;
    try {
      const url = getApiUrl(
        (API_ENDPOINTS.PROJECT_RAG_DELETE_DOC as (pid: string, did: number) => string)(effectiveId, doc.id)
      );
      const resp = await fetch(url, { method: 'DELETE' });
      if (!resp.ok) {
        // Текст из detail объясняет причину («хранилище недоступно»),
        // голый код ответа пользователю ничего не говорит.
        const detail = await resp.json().then(d => d?.detail).catch(() => null);
        throw new Error(detail || `HTTP ${resp.status}`);
      }
      setBanner({ message: `«${doc.filename}» удалён`, severity: 'success' });
      setDocuments(await fetchList(effectiveId));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setBanner({ message: `Ошибка удаления: ${msg}`, severity: 'error' });
    }
  };

  const dropZone = (
    <Box
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
      }}
      sx={{
        border: '2px dashed',
        borderColor: 'divider',
        borderRadius: 2,
        p: dense ? 2 : 3,
        textAlign: 'center',
        mb: 2,
        bgcolor: 'action.hover',
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        accept=".pdf,.doc,.docx,.docm,.xls,.xlsx,.xlsm,.txt,.csv,.md,.log,.rtf"
        onChange={(e) => {
          const list = e.target.files;
          if (!list?.length) return;
          const snapshot = Array.from(list);
          e.target.value = '';
          void uploadFiles(snapshot);
        }}
      />
      <UploadIcon sx={{ fontSize: dense ? 32 : 40, color: 'text.secondary', mb: 1 }} />
      <Typography variant="body2" gutterBottom>
        Перетащите файлы сюда или нажмите кнопку — загрузка сразу на сервер
      </Typography>
      <Button
        variant="contained"
        size={dense ? 'small' : 'medium'}
        startIcon={<UploadIcon />}
        disabled={uploading}
        onClick={() => fileInputRef.current?.click()}
      >
        Выбрать файлы
      </Button>
    </Box>
  );

  return (
    <Box>
      <Typography variant="subtitle2" fontWeight={600} gutterBottom>
        Файлы проекта (RAG)
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        {subtitle}
      </Typography>

      {banner && (
        <Alert
          severity={banner.severity}
          onClose={() => setBanner(null)}
          sx={
            banner.severity === 'warning'
              ? {
                  mb: 2,
                  bgcolor: 'rgba(255, 152, 0, 0.12)',
                  color: 'warning.main',
                  border: '1px solid',
                  borderColor: 'warning.main',
                  '& .MuiAlert-icon': { color: 'warning.main' },
                }
              : { mb: 2 }
          }
        >
          {banner.message}
        </Alert>
      )}

      {ragReadyMessage && (
        <Alert
          severity="success"
          onClose={clearRagReadyMessage}
          sx={{
            mb: 2,
            bgcolor: 'rgba(76, 175, 80, 0.12)',
            color: 'success.main',
            border: '1px solid',
            borderColor: 'success.main',
            '& .MuiAlert-icon': { color: 'success.main' },
          }}
        >
          {ragReadyMessage}
        </Alert>
      )}

      {dropZone}

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="subtitle2">
          Проиндексированные документы ({documents.length + pendingUploads.length})
        </Typography>
        <Button
          size="small"
          startIcon={<RefreshIcon />}
          onClick={() => loadDocuments()}
          disabled={loading || !effectiveId}
        >
          Обновить
        </Button>
      </Box>

      {!effectiveId ? (
        <Typography color="text.secondary" variant="body2">
          После выбора файлов будет создан черновик проекта (если его ещё нет), и документы сразу попадут в хранилище.
        </Typography>
      ) : loading ? (
        <LinearProgress />
      ) : documents.length === 0 && pendingUploads.length === 0 ? (
        <Typography color="text.secondary" variant="body2">
          Пока нет документов. Загрузите файлы выше — они станут доступны для поиска в рамках этого проекта.
        </Typography>
      ) : (
        <List dense disablePadding>
          {pendingUploads.map((pending) => (
            <ListItem
              key={pending.clientId}
              sx={{ borderBottom: 1, borderColor: 'divider' }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>
                <RagUploadingFileThumb filename={pending.filename} size={28} />
              </ListItemIcon>
              <ListItemText
                primary={pending.filename}
                secondary={getRagFileTypeLabel(pending.filename)}
              />
            </ListItem>
          ))}
          {documents.map((doc) => (
            <ListItem
              key={doc.id}
              secondaryAction={
                <Tooltip title="Удалить из БД и MinIO">
                  <IconButton edge="end" onClick={() => handleDelete(doc)} color="error" size="small">
                    <DeleteIcon />
                  </IconButton>
                </Tooltip>
              }
              sx={{ borderBottom: 1, borderColor: 'divider' }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>{getFileIcon(doc.filename)}</ListItemIcon>
              <ListItemText
                primary={doc.filename}
                secondary={
                  <>
                    {formatFileSize(doc.size ?? null)}
                    {doc.created_at && (
                      <>
                        {' · '}
                        {new Date(doc.created_at).toLocaleString('ru-RU')}
                      </>
                    )}
                  </>
                }
              />
              <Chip
                size="small"
                label={`#${ragDocumentDisplayIndex(documents, doc.id)}`}
                sx={{ mr: 4 }}
              />
            </ListItem>
          ))}
        </List>
      )}
    </Box>
  );
}
