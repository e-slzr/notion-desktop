#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$HOME/.local/lib/notion-desktop"
BIN_DIR="$HOME/.local/bin"
APP_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons/hicolor"

# Limpiar instalaciones previas para evitar sobrescribir con enlaces recursivos
rm -rf "$INSTALL_DIR"
rm -f "$BIN_DIR/notion-desktop"

mkdir -p "$INSTALL_DIR"
mkdir -p "$BIN_DIR"
mkdir -p "$APP_DIR"
mkdir -p "$ICON_DIR/scalable/apps"

# Copiar el binario compilado listo para producción
cp -r "$SCRIPT_DIR/dist/linux-unpacked/"* "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/notion-desktop"

# Crear script ejecutable seguro en PATH
cat << 'EOF' > "$BIN_DIR/notion-desktop"
#!/bin/sh
exec "$HOME/.local/lib/notion-desktop/notion-desktop" --no-sandbox "$@"
EOF
chmod +x "$BIN_DIR/notion-desktop"

# Instalar iconos en todas las resoluciones estándar para Ulauncher, Plank y Dash to Dock
# Se instalan tanto bajo 'notion' como 'notion-desktop' en hicolor para compatibilidad y fallback universal
cp "$SCRIPT_DIR/assets/icon.svg" "$ICON_DIR/scalable/apps/notion-desktop.svg"
cp "$SCRIPT_DIR/assets/icon.svg" "$ICON_DIR/scalable/apps/notion.svg"
for size in 16 24 32 48 64 128 256 512; do
  mkdir -p "$ICON_DIR/${size}x${size}/apps"
  if [ -f "$SCRIPT_DIR/assets/icons/${size}x${size}/notion-desktop.png" ]; then
    cp "$SCRIPT_DIR/assets/icons/${size}x${size}/notion-desktop.png" "$ICON_DIR/${size}x${size}/apps/notion-desktop.png"
    cp "$SCRIPT_DIR/assets/icons/${size}x${size}/notion-desktop.png" "$ICON_DIR/${size}x${size}/apps/notion.png"
  fi
done

# Detectar si el tema de iconos del sistema tiene un icono para Notion (e.g. 'notion', 'notion-desktop')
THEME_NAME=$(gsettings get org.gnome.desktop.interface icon-theme 2>/dev/null | tr -d "'\"" || true)
DESKTOP_ICON="notion"

for candidate in notion notion-desktop notion-app notion-app-enhanced; do
  for base in "$HOME/.local/share/icons" "$HOME/.icons" "/usr/local/share/icons" "/usr/share/icons"; do
    if [ -n "$THEME_NAME" ] && [ -d "$base/$THEME_NAME" ]; then
      if find -L "$base/$THEME_NAME" \( -name "${candidate}.svg" -o -name "${candidate}.png" \) 2>/dev/null | grep -q .; then
        DESKTOP_ICON="$candidate"
        break 2
      fi
    fi
  done
done

# Crear archivo .desktop oficial del sistema con nombre temático de icono y WM_CLASS sincronizada
cat <<EOF > "$APP_DIR/notion-desktop.desktop"
[Desktop Entry]
Name=Notion
Comment=Cliente de escritorio para Notion
GenericName=Notas y productividad
Exec=$BIN_DIR/notion-desktop %u
Icon=$DESKTOP_ICON
Terminal=false
Type=Application
Categories=Office;ProjectManagement;TextEditor;Utility;
StartupWMClass=notion-desktop
Keywords=notion;notes;notas;productivity;productividad;workspace;wiki;
MimeType=x-scheme-handler/notion;
EOF

chmod +x "$APP_DIR/notion-desktop.desktop"

# Actualizar base de datos de escritorio e iconos de GTK
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$APP_DIR"
fi

if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -f -t "$ICON_DIR" 2>/dev/null || true
fi

echo "¡Notion Desktop v1.0.1 instalado con icono '$DESKTOP_ICON' sincronizado con el tema del sistema!"
