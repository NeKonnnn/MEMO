import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { CssBaseline, Box, IconButton, AppBar, Toolbar } from '@mui/material';
import { Menu as MenuIcon } from '@mui/icons-material';
import Sidebar from './components/Sidebar';
import ChatPage from './pages/ChatPage';
import VoicePage from './pages/VoicePage';
import DocumentsPage from './pages/DocumentsPage';
import TranscriptionPage from './pages/TranscriptionPage';
import SettingsPage from './pages/SettingsPage';
import HistoryPage from './pages/HistoryPage';
import { SocketProvider } from './contexts/SocketContext';
import { AppProvider } from './contexts/AppContext';
import './App.css';

// Создаем тему Material-UI
const createAppTheme = (isDark: boolean) => createTheme({
  palette: {
    mode: isDark ? 'dark' : 'light',
    primary: {
      main: '#2196f3',
      dark: '#1976d2',
      light: '#64b5f6',
    },
    secondary: {
      main: '#f50057',
      dark: '#c51162',
      light: '#ff5983',
    },
    background: {
      default: isDark ? '#121212' : '#fafafa',
      paper: isDark ? '#1e1e1e' : '#ffffff',
    },
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    h4: {
      fontWeight: 600,
    },
    h6: {
      fontWeight: 500,
    },
  },
  shape: {
    borderRadius: 12,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: 8,
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        },
      },
    },
  },
});

function App() {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('memoai-dark-mode');
    return saved ? JSON.parse(saved) : false;
  });

  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    localStorage.setItem('memoai-dark-mode', JSON.stringify(isDarkMode));
  }, [isDarkMode]);

  const theme = createAppTheme(isDarkMode);

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
  };

  const toggleSidebar = () => {
    console.log('🔄 Переключение сайдбара:', sidebarOpen, '->', !sidebarOpen);
    setSidebarOpen(!sidebarOpen);
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppProvider>
        <SocketProvider>
          <Router>
            <Box sx={{ display: 'flex', height: '100vh' }}>
              <Sidebar 
                open={sidebarOpen} 
                onToggle={toggleSidebar}
                isDarkMode={isDarkMode}
                onToggleTheme={toggleTheme}
              />
              <Box 
                component="main" 
                sx={{ 
                  flexGrow: 1, 
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  marginLeft: sidebarOpen ? 0 : '-280px',
                  transition: 'margin-left 0.3s ease',
                }}
              >
                {/* AppBar с кнопкой меню (показывается только когда сайдбар закрыт) */}
                {!sidebarOpen && (
                  <AppBar position="static" sx={{ zIndex: 1201 }}>
                    <Toolbar>
                      <IconButton
                        edge="start"
                        color="inherit"
                        aria-label="menu"
                        onClick={toggleSidebar}
                        sx={{ mr: 2 }}
                      >
                        <MenuIcon />
                      </IconButton>
                    </Toolbar>
                  </AppBar>
                )}
                
                <Routes>
                  <Route path="/" element={<ChatPage />} />
                  <Route path="/chat" element={<ChatPage />} />
                  <Route path="/voice" element={<VoicePage />} />
                  <Route path="/documents" element={<DocumentsPage />} />
                  <Route path="/transcription" element={<TranscriptionPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/history" element={<HistoryPage />} />
                </Routes>
              </Box>
            </Box>
          </Router>
        </SocketProvider>
      </AppProvider>
    </ThemeProvider>
  );
}

export default App;