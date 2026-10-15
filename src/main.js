const { app, BrowserWindow, WebContentsView, ipcMain, shell, nativeTheme, Notification, session, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

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
let resolvedSystemIcon = undefined;

let cleanUA = '';

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

// Comprueba si alguno de los nombres de icono candidatos existe en el tema del sistema Linux
function checkSystemIconAvailable(candidateNames) {
  if (process.platform !== 'linux') return null;
  const names = Array.isArray(candidateNames) ? candidateNames : [candidateNames];

  const home = os.homedir();
  const baseDirs = [
    path.join(home, '.local/share/icons'),
    path.join(home, '.icons'),
    '/usr/local/share/icons',
    '/usr/share/icons',
    '/usr/share/pixmaps'
  ];

  const exts = ['.svg', '.png', '.xpm'];

  const themes = new Set();
  try {
    const stdout = execSync('gsettings get org.gnome.desktop.interface icon-theme', { encoding: 'utf8', timeout: 500 }).trim();
    const currentTheme = stdout.replace(/^['\"]|['\"]$/g, '');
    if (currentTheme) themes.add(currentTheme);
  } catch (e) {}
  themes.add('hicolor');

  for (const name of names) {
    // 1. Comprobar directamente en pixmaps
    for (const ext of exts) {
      if (fs.existsSync(path.join('/usr/share/pixmaps', name + ext))) {
        return name;
      }
    }

    // 2. Comprobar en tema activo y tema fallback hicolor
    for (const base of baseDirs) {
      if (!fs.existsSync(base)) continue;
      for (const theme of themes) {
        const themePath = path.join(base, theme);
        if (!fs.existsSync(themePath)) continue;
        const subdirs = [
          'apps/scalable', 'scalable/apps', 'apps',
          '512x512/apps', '256x256/apps', '128x128/apps',
          '64x64/apps', '48x48/apps', '32x32/apps', '24x24/apps', '16x16/apps'
        ];
        for (const sub of subdirs) {
          for (const ext of exts) {
            if (fs.existsSync(path.join(themePath, sub, name + ext))) {
              return name;
            }
          }
        }
      }
    }

    // 3. Comprobar en otros temas instalados en los directorios base
    for (const base of baseDirs) {
      if (!fs.existsSync(base)) continue;
      try {
        const entries = fs.readdirSync(base, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const themePath = path.join(base, entry.name);
          const subdirs = ['apps/scalable', 'scalable/apps', 'apps', '512x512/apps', '256x256/apps', '48x48/apps'];
          for (const sub of subdirs) {
            for (const ext of exts) {
              if (fs.existsSync(path.join(themePath, sub, name + ext))) {
                return name;
              }
            }
          }
        }
      } catch (e) {}
    }
  }

  return null;
}

function getSystemIconName(candidateNames) {
  if (resolvedSystemIcon !== undefined) return resolvedSystemIcon;
  resolvedSystemIcon = checkSystemIconAvailable(candidateNames);
  return resolvedSystemIcon;
}

// Ruta física al icono por defecto empaquetado con la aplicación
function getDefaultIconPath() {
  if (process.resourcesPath) {
    const unpackedIcon = path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'icon.png');
    if (fs.existsSync(unpackedIcon)) {
      return unpackedIcon;
    }
  }
  const devIcon = path.join(__dirname, '../assets/icon.png');
  if (fs.existsSync(devIcon) && !devIcon.includes('app.asar')) {
    return devIcon;
  }
  return path.join(__dirname, '../assets/icon.png');
}

function triggerDesktopNotification(title, body) {
  const notifTitle = title || 'Notion';
  const notifBody = body || 'Nueva notificación';
  const defaultIconPath = getDefaultIconPath();

  console.log('[NOTIF DISPARADA]:', notifTitle, notifBody);

  // 1. Notificación nativa de Electron (utiliza DBus / org.freedesktop.Notifications con soporte completo de icono y clic)
  if (Notification.isSupported()) {
    try {
      let iconOption;
      if (process.platform === 'linux') {
        const systemIcon = getSystemIconName(['notion', 'notion-desktop', 'notion-app', 'notion-app-enhanced']);
        if (systemIcon) {
          // Si el tema de iconos del sistema tiene el icono disponible, usamos su nombre de tema para evitar el badge [i]
          iconOption = systemIcon;
        } else if (fs.existsSync(defaultIconPath)) {
          // Si no está disponible en el tema del sistema, usamos el icono por defecto empaquetado
          const img = nativeImage.createFromPath(defaultIconPath);
          iconOption = img.isEmpty() ? defaultIconPath : img;
        } else {
          iconOption = defaultIconPath;
        }
      } else if (fs.existsSync(defaultIconPath)) {
        const img = nativeImage.createFromPath(defaultIconPath);
        iconOption = img.isEmpty() ? defaultIconPath : img;
      } else {
        iconOption = defaultIconPath;
      }

      const notif = new Notification({
        title: notifTitle,
        body: notifBody,
        icon: iconOption,
        silent: false
      });

      notif.on('click', () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        }
        if (notionView) {
          notionView.webContents.focus();
        }
      });

      notif.show();
      return;
    } catch (err) {
      console.error('Error al mostrar notificación nativa:', err);
    }
  }

  // 2. Fallback con notify-send para entornos Linux donde Notification.isSupported() falle
  if (process.platform === 'linux') {
    const { execFile } = require('child_process');
    const systemIcon = getSystemIconName(['notion', 'notion-desktop', 'notion-app', 'notion-app-enhanced']);
    const notifIcon = systemIcon || defaultIconPath;
    execFile('notify-send', [
      '-a', 'notion-desktop',
      '-i', notifIcon,
      '-h', 'string:desktop-entry:notion-desktop',
      '-u', 'normal',
      notifTitle,
      notifBody
    ], (err) => {
      if (err) console.error('Error al emitir notify-send:', err);
    });
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
    icon: getDefaultIconPath(),
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

  // Crear la vista web principal con sesión persistente
  notionView = new WebContentsView({
    webPreferences: {
      partition: 'persist:notion',
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    }
  });

  // Limpiar UserAgent dinámicamente eliminando el token de Electron
  const defaultUA = notionView.webContents.userAgent;
  cleanUA = defaultUA.replace(/Electron\/[0-9\.]+\s?/, '').replace(/notion-desktop\/[0-9\.]+\s?/, '');
  notionView.webContents.setUserAgent(cleanUA);
  app.userAgentFallback = cleanUA;

  // Configuración de la sesión persistente de Notion
  const notionSession = notionView.webContents.session;
  notionSession.setUserAgent(cleanUA);

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

  // Manejo de apertura de ventanas (popups de autenticación o enlaces externos)
  notionView.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedAppUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: mainWindow,
          modal: false,
          width: 600,
          height: 720,
          center: true,
          autoHideMenuBar: true,
          title: 'Notion',
          backgroundColor: isDark ? '#202020' : '#ffffff',
          webPreferences: {
            partition: 'persist:notion',
            contextIsolation: true,
            nodeIntegration: false
          }
        }
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Navegación dentro de la vista principal
  notionView.webContents.on('will-navigate', (event, url) => {
    if (isAllowedAppUrl(url)) {
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
  if (cleanUA) {
    contents.setUserAgent(cleanUA);
  }

  contents.on('will-navigate', (navEvent, url) => {
    if (!isAllowedAppUrl(url)) {
      navEvent.preventDefault();
      shell.openExternal(url);
    }
  });

  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedAppUrl(url)) {
      return { action: 'allow' };
    }
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
