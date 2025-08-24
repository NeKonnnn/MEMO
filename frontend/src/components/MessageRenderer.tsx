import React, { useState } from 'react';
import { Box, IconButton, Typography, Tooltip } from '@mui/material';
import { ContentCopy as CopyIcon, Check as CheckIcon } from '@mui/icons-material';

interface MessageRendererProps {
  content: string;
  isStreaming?: boolean;
}

const MessageRenderer: React.FC<MessageRendererProps> = ({ content, isStreaming = false }) => {
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch (error) {
      console.error('Failed to copy code:', error);
    }
  };

  // Простая функция для парсинга кодовых блоков
  const renderContent = (text: string) => {
    const parts = text.split(/(```[\s\S]*?```)/g);
    
    return parts.map((part, index) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        // Кодовый блок - сначала пытаемся с языком
        let codeMatch = part.match(/```(\w+)\n([\s\S]*?)```/);
        let language = 'text';
        let code = '';
        
        if (codeMatch) {
          // Есть язык программирования
          language = codeMatch[1];
          code = codeMatch[2];
        } else {
          // Нет языка, пытаемся без языка
          const simpleMatch = part.match(/```\n?([\s\S]*?)```/);
          if (simpleMatch) {
            code = simpleMatch[1];
          }
        }
        
        if (code !== undefined) {
          
          return (
            <Box key={index} sx={{ position: 'relative', my: 2 }}>
              <Box
                sx={{
                  backgroundColor: '#1e1e1e',
                  borderRadius: 1,
                  p: 0,
                  position: 'relative',
                }}
              >
                {/* Заголовок блока кода */}
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    px: 2,
                    py: 1,
                    backgroundColor: '#2d2d30',
                    borderRadius: '4px 4px 0 0',
                    borderBottom: '1px solid #3e3e42',
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{
                      color: '#cccccc',
                      fontFamily: 'monospace',
                      textTransform: 'uppercase',
                      fontSize: '0.75rem',
                    }}
                  >
                    {language}
                  </Typography>
                  <Tooltip title={copiedCode === code ? 'Скопировано!' : 'Копировать код'}>
                    <IconButton
                      size="small"
                      onClick={() => handleCopyCode(code)}
                      sx={{
                        color: '#cccccc',
                        '&:hover': {
                          backgroundColor: 'rgba(255,255,255,0.1)',
                        },
                      }}
                    >
                      {copiedCode === code ? (
                        <CheckIcon fontSize="small" />
                      ) : (
                        <CopyIcon fontSize="small" />
                      )}
                    </IconButton>
                  </Tooltip>
                </Box>
                
                {/* Код */}
                <Box
                  component="pre"
                  sx={{
                    margin: 0,
                    padding: 2,
                    backgroundColor: '#1e1e1e',
                    color: '#d4d4d4',
                    fontFamily: '"Fira Code", "Monaco", "Menlo", "Consolas", monospace',
                    fontSize: '0.875rem',
                    lineHeight: 1.5,
                    overflow: 'auto',
                    borderRadius: '0 0 4px 4px',
                    whiteSpace: 'pre-wrap', // Изменено на pre-wrap для лучшего переноса
                    tabSize: 4,
                    WebkitTabSize: 4,
                    MozTabSize: 4,
                  }}
                >
                  <code>{code}</code>
                </Box>
              </Box>
            </Box>
          );
        }
      }
      
      // Обычный текст с поддержкой инлайн кода
      return (
        <Typography
          key={index}
          variant="body1"
          component="div"
          sx={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            lineHeight: 1.5,
            '& code': {
              backgroundColor: 'rgba(175, 184, 193, 0.2)',
              padding: '2px 4px',
              borderRadius: '3px',
              fontFamily: 'monospace',
              fontSize: '0.875em',
            },
          }}
        >
          {part.split(/(`[^`]+`)/).map((subPart, subIndex) => {
            if (subPart.startsWith('`') && subPart.endsWith('`')) {
              return (
                <Box component="code" key={subIndex}>
                  {subPart.slice(1, -1)}
                </Box>
              );
            }
            return subPart;
          })}
        </Typography>
      );
    });
  };

  return (
    <Box sx={{ position: 'relative' }}>
      {renderContent(content)}
      
      {/* Улучшенный курсор печати для потокового режима */}
      {isStreaming && (
        <Box
          component="span"
          sx={{
            display: 'inline-block',
            width: '2px',
            height: '1.2em',
            backgroundColor: 'primary.main',
            animation: 'blink 1s infinite',
            '@keyframes blink': {
              '0%, 50%': { 
                opacity: 1,
                backgroundColor: 'primary.main'
              },
              '51%, 100%': { 
                opacity: 0,
                backgroundColor: 'transparent'
              },
            },
            ml: 0.5,
            verticalAlign: 'text-bottom',
          }}
        />
      )}
    </Box>
  );
};

export default MessageRenderer;
