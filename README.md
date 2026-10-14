# Notion Desktop

[![Build & Release](https://github.com/e-slzr/notion-desktop/actions/workflows/release.yml/badge.svg)](https://github.com/e-slzr/notion-desktop/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: Linux | Windows | macOS](https://img.shields.io/badge/Platform-Linux%20%7C%20Windows%20%7C%20macOS-informational.svg)]()

Cliente de escritorio independiente, elegante y de alto rendimiento para **Notion**, desarrollado sobre Electron con soporte de sesión persistente, integración visual con el sistema, navegación fluida e inicio de sesión seguro (Google OAuth, Apple ID, SAML/SSO) directamente dentro de la aplicación.

---

## ✨ Características Principales

- 🔐 **Inicio de Sesión Unificado sin Salir de la Ventana**:
  - Compatible con inicio de sesión mediante **Google OAuth**, **Apple ID**, **Microsoft / Office 365** y proveedores de **SSO/SAML** corporativos (Okta, Auth0, etc.).
  - Cabeceras Client Hints (`sec-ch-ua`) y User-Agent sanitizados para prevenir el bloqueo de Google (*"Este navegador o aplicación no es seguro"*).
  - Los diálogos de autorización se resuelven de forma nativa e integrada sin abrir navegadores externos del sistema.
- 🧭 **Navegación Histórica Fluida**:
  - Botones dedicados de **Atrás** (`←`) y **Adelante** (`→`) en la barra de título con atajos de teclado (`Alt + ←`, `Alt + →`).
  - Botón de recarga rápida (`↻`) y atajo `Ctrl + R` / `F5`.
- 🎨 **Diseño Minimalista Adaptativo (Light & Dark)**:
  - Barra de título personalizada integrada con la paleta estética original de Notion.
  - Se adapta automáticamente al modo oscuro o claro del sistema operativo.
- 🚀 **Rendimiento y Ligereza**:
  - Basado en `WebContentsView` nativo de Electron.
  - Consumo mínimo de memoria RAM y aceleración por hardware en GPU.
- 🖥️ **Integración Perfecta con Linux (Wayland & X11)**:
  - Sincronización continua de redimensionamiento bidireccional (IPC) para evitar problemas de congelamiento de superficie en compositores Wayland (GNOME, elementary OS Gala, KDE Plasma) y tarjetas NVIDIA.
  - Jerarquía completa de iconos en resoluciones estándar (`16x16` hasta `512x512` y SVG) para Plank, Dash to Dock y lanzadores de aplicaciones.
  - Notificaciones de escritorio nativas mediante `notify-send`.
- ✍️ **Corrector Ortográfico Integrado**:
  - Soporte multilingüe simultáneo para Español e Inglés en documentos y notas.
- 💾 **Persistencia de Sesión y Posición**:
  - Tu sesión permanece guardada permanentemente (`persist:notion`).
  - La ventana recuerda su tamaño, estado maximizado y última página visitada.

---

## 📦 Instalación Rápida en Linux

Si deseas compilar e integrar Notion Desktop localmente en tu menú de aplicaciones y dock:

```bash
# 1. Clonar el repositorio
git clone https://github.com/e-slzr/notion-desktop.git
cd notion-desktop

# 2. Instalar dependencias
npm install

# 3. Compilar los paquetes de producción para Linux
npm run dist:linux

# 4. Instalar en el sistema (~/.local/bin y menú de aplicaciones)
./install-app.sh
```

---

## 🛠️ Desarrollo Local

Para ejecutar la aplicación en modo desarrollo:

```bash
npm start
```

---

## 🏗️ Compilación Multiplataforma

Los scripts de empaquetado generan binarios limpios y optimizados:

| Plataforma | Comando | Formatos de salida |
| :--- | :--- | :--- |
| **Linux** | `npm run dist:linux` | `.AppImage`, `.deb`, `linux-unpacked/` |
| **Windows** | `npm run dist:win` | Instalador `.exe` (NSIS) |
| **macOS** | `npm run dist:mac` | `.dmg` |
| **Todas** | `npm run dist:all` | Todos los paquetes multiplataforma |

---

## ⚖️ Descargo de Responsabilidad (Trademark Disclaimer)

Notion es una marca registrada de **Notion Labs, Inc.** Este proyecto es un cliente de escritorio comunitario independiente de código abierto y no está afiliado, patrocinado, respaldado ni respaldado oficialmente por Notion Labs, Inc.

---

## 📄 Licencia

Distribuido bajo la Licencia **MIT**. Consulta el archivo [LICENSE](LICENSE) para más detalles.

---

## 👤 Autor

Desarrollado con dedicación por **Eliu Salazar** ([@e-slzr](https://github.com/e-slzr)) - [eliu.asalazar@gmail.com](mailto:eliu.asalazar@gmail.com).
