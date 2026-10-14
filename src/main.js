const { app, BrowserWindow, WebContentsView, ipcMain, shell, nativeTheme, Notification, session } = require('electron');
const path = require('path');
const fs = require('fs');

// Permitir reproducción de medios y audio sin interacción previa
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-features', 'OverlayScrollbar');

const TITLEBAR_HEIGHT = 44;
const DEFAULT_URL = 'https://www.notion.so';
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');

app.setName('Notion');
app.setAppUserModelId('com.eslzr.notion-desktop');
if (process.platform === 'linux' && typeof app.setDesktopName === 'function') {
  app.setDesktopName('notion-desktop.desktop');
}

// Registrar cliente de protocolo para deep linking (notion://)
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('notion', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('notion');
}

// Bloqueo de instancia única
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let mainWindow = null;
let notionView = null;
let lastUnreadCount = 0;
let lastNotificationTime = 0;
let currentLoadedUrl = DEFAULT_URL;

// Versión moderna de Chrome para evitar bloqueo de Google OAuth ("Este navegador o app no es seguro")
const CHROME_VERSION = '131.0.0.0';
const CHROME_MAJOR = '131';
const CHROME_UA = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`;
app.userAgentFallback = CHROME_UA;

function isNotionDomain(rawUrl) {
  if (!rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    return host === 'notion.so' || host.endsWith('.notion.so') ||
           host === 'notion.com' || host.endsWith('.notion.com') ||
           host === 'notion.site' || host.endsWith('.notion.site') ||
           host === 'notion.new';
  } catch {
    return false;
  }
}

function isOAuthProviderUrl(rawUrl) {
  if (!rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    return host === 'accounts.google.com' || host.endsWith('.accounts.google.com') ||
           host === 'appleid.apple.com' ||
           host === 'login.microsoftonline.com' || host.endsWith('.microsoftonline.com') ||
           host === 'login.live.com';
  } catch {
    return false;
  }
}

function isAuthDomain(rawUrl) {
  if (!rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();

    // Google APIs / OAuth
    if (host === 'google.com' || host.endsWith('.google.com') ||
        host.endsWith('.googleusercontent.com') ||
        host.endsWith('.gstatic.com') ||
        host.endsWith('.googleapis.com') ||
        host.endsWith('.youtube.com')) {
      return true;
    }

    // Apple
    if (host === 'apple.com' || host.endsWith('.apple.com') ||
        host.endsWith('.apple-cloudkit.com')) {
      return true;
    }

    // Microsoft
    if (host === 'microsoft.com' || host.endsWith('.microsoft.com') ||
        host.endsWith('.msftauth.net') || host.endsWith('.msauth.net') ||
        host.endsWith('.windows.net')) {
      return true;
    }

    // Enterprise SSO (Okta, Auth0, OneLogin, Duo)
    if (host.endsWith('.okta.com') || host.endsWith('.oktapreview.com') ||
        host.endsWith('.auth0.com') || host.endsWith('.onelogin.com') ||
        host.endsWith('.duosecurity.com')) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

function isAllowedAppUrl(rawUrl) {
  return isNotionDomain(rawUrl) || isAuthDomain(rawUrl);
}

function triggerDesktopNotification(title, body) {
  const notifTitle = title || 'Notion';
  const notifBody = body || 'Nueva notificación';
  const notifIcon = path.join(__dirname, '../assets/icon.png');

  if (process.platform === 'linux') {
    const { execFile } = require('child_process');
    execFile('notify-send', [
      '-a', 'Notion',
      '-i', notifIcon,
      '-u', 'normal',
      notifTitle,
      notifBody
    ], (err) => {
      if (err) console.error('Error al emitir notify-send:', err);
    });
  } else if (Notification.isSupported()) {
    try {
      const notif = new Notification({
        title: notifTitle,
        body: notifBody,
        icon: notifIcon
      });
      notif.on('click', () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        }
      });
      notif.show();
    } catch (err) {
      console.error('Error al mostrar notificación nativa:', err);
    }
  }
}

function loadWindowState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch {}
  return { width: 1200, height: 800, isMaximized: false };
}

function saveWindowState() {
  if (!mainWindow) return;
  try {
    const isMaximized = mainWindow.isMaximized();
    const bounds = mainWindow.getNormalBounds ? mainWindow.getNormalBounds() : mainWindow.getBounds();
    const state = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      isMaximized
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch {}
}

function updateViewBounds() {
  if (!mainWindow || !notionView) return;
  const [width, height] = mainWindow.getContentSize();
  notionView.setBounds({
    x: 0,
    y: TITLEBAR_HEIGHT,
    width: width,
    height: Math.max(0, height - TITLEBAR_HEIGHT)
  });
}

function syncNavigationState() {
  if (!mainWindow || !notionView) return;
  const canGoBack = notionView.webContents.canGoBack();
  const canGoForward = notionView.webContents.canGoForward();
  mainWindow.webContents.send('navigation-state', { canGoBack, canGoForward });
}

function createWindow() {
  const isDark = nativeTheme.shouldUseDarkColors;
  const bgColor = isDark ? '#202020' : '#ffffff';
  const state = loadWindowState();

  mainWindow = new BrowserWindow({
    width: state.width || 1200,
    height: state.height || 800,
    x: state.x,
    y: state.y,
    minWidth: 750,
    minHeight: 500,
    frame: false,
    backgroundColor: bgColor,
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (state.isMaximized) {
    mainWindow.maximize();
  }

  // Cargar barra de título personalizada
  mainWindow.loadFile(path.join(__dirname, 'titlebar.html'));

  // Configuración de la sesión persistente de Notion
  const notionSession = session.fromPartition('persist:notion');

  // Sobrescribir User-Agent y cabeceras Client Hints sec-ch-ua para Google OAuth y servicios protegidos
  notionSession.setUserAgent(CHROME_UA);

  notionSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = CHROME_UA;
    details.requestHeaders['sec-ch-ua'] = `"Google Chrome";v="${CHROME_MAJOR}", "Chromium";v="${CHROME_MAJOR}", "Not_A Brand";v="24"`;
    details.requestHeaders['sec-ch-ua-mobile'] = '?0';
    details.requestHeaders['sec-ch-ua-platform'] = '"Linux"';
    callback({ cancel: false, requestHeaders: details.requestHeaders });
  });

  // Idiomas para el corrector ortográfico integrado
  try {
    notionSession.setSpellCheckerLanguages(['es', 'en-US']);
  } catch {}

  // Manejador de permisos (notificaciones, portapapeles, medios, pantalla)
  const allowedPermissions = [
    'notifications',
    'clipboard-read',
    'clipboard-write',
    'clipboard-sanitized-write',
    'media',
    'audio-capture',
    'video-capture',
    'display-capture',
    'fullscreen'
  ];

  notionSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(allowedPermissions.includes(permission));
  });

  notionSession.setPermissionCheckHandler((webContents, permission) => {
    return allowedPermissions.includes(permission);
  });

  // Crear la vista web principal con sesión persistente
  notionView = new WebContentsView({
    webPreferences: {
      partition: 'persist:notion',
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    }
  });

  notionView.webContents.setUserAgent(CHROME_UA);
  mainWindow.contentView.addChildView(notionView);

  // Sincronización inicial de dimensiones de la vista
  updateViewBounds();
  setTimeout(updateViewBounds, 50);
  setTimeout(updateViewBounds, 250);

  currentLoadedUrl = DEFAULT_URL;
  notionView.webContents.loadURL(DEFAULT_URL);

  // Eventos de ventana
  mainWindow.on('resize', updateViewBounds);
  mainWindow.on('show', updateViewBounds);
  mainWindow.on('restore', updateViewBounds);

  mainWindow.on('maximize', () => {
    updateViewBounds();
    mainWindow.webContents.send('window-maximize-changed', true);
  });

  mainWindow.on('unmaximize', () => {
    updateViewBounds();
    mainWindow.webContents.send('window-maximize-changed', false);
  });

  // Manejo de apertura de ventanas (enlaces externos y OAuth): Abrir siempre en el navegador del sistema
  notionView.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Navegación dentro de la vista principal
  notionView.webContents.on('will-navigate', (event, url) => {
    if (isOAuthProviderUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
      return;
    }

    if (isAllowedAppUrl(url)) {
      // Permitir la navegación interna
      return;
    }
    event.preventDefault();
    shell.openExternal(url);
  });

  // Monitoreo de cambios de URL para historial
  const handleUrlChange = (_event, url) => {
    currentLoadedUrl = url;
    syncNavigationState();
  };

  notionView.webContents.on('did-navigate', handleUrlChange);
  notionView.webContents.on('did-navigate-in-page', handleUrlChange);

  // Atajos de teclado para navegación y recarga
  notionView.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown') {
      // Alt + Izquierda: Atrás
      if (input.alt && input.key === 'ArrowLeft' && notionView.webContents.canGoBack()) {
        notionView.webContents.goBack();
        event.preventDefault();
      }
      // Alt + Derecha: Adelante
      else if (input.alt && input.key === 'ArrowRight' && notionView.webContents.canGoForward()) {
        notionView.webContents.goForward();
        event.preventDefault();
      }
      // Ctrl + R / F5: Recargar
      else if ((input.control && input.key.toLowerCase() === 'r') || input.key === 'F5') {
        notionView.webContents.reload();
        event.preventDefault();
      }
    }
  });

  // Monitoreo de título y notificaciones
  notionView.webContents.on('page-title-updated', (_event, title) => {
    mainWindow.setTitle(title || 'Notion');

    // Detección de insignia de mensajes o recordatorios en el título
    const match = title.match(/\(([\d\+]+)\)/);
    const count = match ? match[1] : 0;
    const numericCount = parseInt(count, 10) || 0;

    mainWindow.webContents.send('update-unread', count);
    mainWindow.webContents.send('update-title', title);

    const now = Date.now();
    if (numericCount > lastUnreadCount && (now - lastNotificationTime) > 3000) {
      const diff = numericCount - lastUnreadCount;
      const msg = diff > 1 ? `Tienes ${diff} nuevos recordatorios o menciones en Notion` : 'Tienes una nueva notificación en Notion';
      triggerDesktopNotification('Notion', msg);
      lastNotificationTime = now;
    }
    lastUnreadCount = numericCount;
  });

  mainWindow.on('close', (event) => {
    saveWindowState();
    if (!app.isPackaged) {
      app.isQuitting = true;
    }
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

// Interceptar cualquier WebContents creado (por ejemplo ventanas emergentes)
app.on('web-contents-created', (_event, contents) => {
  contents.setUserAgent(CHROME_UA);

  contents.on('will-navigate', (navEvent, url) => {
    if (isOAuthProviderUrl(url)) {
      navEvent.preventDefault();
      shell.openExternal(url);
      return;
    }

    if (!isAllowedAppUrl(url)) {
      navEvent.preventDefault();
      shell.openExternal(url);
    }
  });

  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
});

// Handlers IPC para controles de ventana y navegación
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) {
    saveWindowState();
    if (!app.isPackaged) {
      app.isQuitting = true;
      app.quit();
    } else {
      mainWindow.hide();
    }
  }
});

ipcMain.on('window-reload', () => {
  if (notionView) notionView.webContents.reload();
});

ipcMain.on('window-go-back', () => {
  if (notionView && notionView.webContents.canGoBack()) {
    notionView.webContents.goBack();
  }
});

ipcMain.on('window-go-forward', () => {
  if (notionView && notionView.webContents.canGoForward()) {
    notionView.webContents.goForward();
  }
});

ipcMain.on('window-resized', (_event, { width, height }) => {
  if (notionView) {
    notionView.setBounds({
      x: 0,
      y: TITLEBAR_HEIGHT,
      width: width,
      height: Math.max(0, height - TITLEBAR_HEIGHT)
    });
  }
});

// Despertar la ventana existente y capturar enlaces notion:// o callbacks del navegador
app.on('second-instance', (_event, commandLine) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();

    const targetUrl = commandLine.find(arg => arg.startsWith('notion://') || arg.startsWith('https://www.notion.so') || arg.startsWith('https://app.notion.com'));
    if (targetUrl && notionView) {
      const cleanUrl = targetUrl.replace(/^notion:\/\//i, 'https://');
      notionView.webContents.loadURL(cleanUrl);
    }
  }
});

// Soporte para deep link en macOS y gestores de escritorio compatibles (XDG)
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  if (notionView && (url.startsWith('notion://') || url.startsWith('https://'))) {
    const cleanUrl = url.replace(/^notion:\/\//i, 'https://');
    notionView.webContents.loadURL(cleanUrl);
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

app.on('before-quit', () => {
  saveWindowState();
  app.isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
