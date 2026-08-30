import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { MENU_MIN_WIDTH_PX } from './constants/menuStyles';
import { initSettings } from './settings';
import { installAstra185GlobalHandlers } from './utils/debugReact185';

// Диагностика белого экрана / React #185 (фильтр в консоли: ASTRA#185)
installAstra185GlobalHandlers();

// Ширина меню задаётся до первого рендера, чтобы глобальные стили в App.css точно её подхватили
document.documentElement.style.setProperty('--menu-min-width', `${MENU_MIN_WIDTH_PX}px`);

// Запускаем загрузку конфига ДО монтирования React — к моменту, когда
// AuthContext и SocketContext вызовут initSettings(), ответ уже будет закэширован.
initSettings().catch(() => { /* игнорируем: дефолтные значения будут применены */ });

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
