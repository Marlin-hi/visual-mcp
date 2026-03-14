# Visual MCP Framework

Universelles Framework für visuelle Browser-Vorschauen, die direkt aus Claude Code heraus gesteuert werden. Inspiriert von Embers Drag/Edit-Ansatz, aber generalisiert für beliebige Domänen.

## Architektur

```
Claude Code ←→ MCP (stdio) ←→ Visual Server (Express) ←→ Browser Preview
                                        ↑
                                  Adapter Plugin
                              (motion/video/web/etc.)
```

Ein Prozess, der gleichzeitig:
1. MCP über stdio spricht (für Claude Code)
2. Express + WebSocket Server hostet (für die Browser-UI)

## Stack

- Node.js, Express, WebSocket (ws)
- MCP SDK (@modelcontextprotocol/sdk)
- Vanilla JS + CSS Frontend (kein Framework)
- Orange Theme (dark, warm, terminal-inspired)

## Dateien

```
server.js              — Express + MCP Hauptserver + /render Endpoint
bin/visual-mcp.js      — CLI Entry Point
lib/
  mcp.js              — MCP stdio Server, Core-Tools
  adapter-loader.js   — Dynamischer Adapter-Loader
adapters/
  motion/index.js     — Motion Graphics Adapter
public/
  index.html          — Visual Editor UI
  app.js              — Client-Logik (Canvas, Interaction, Timeline)
  style.css           — Orange Theme
```

## Core MCP Tools (immer verfügbar)

| Tool | Beschreibung |
|---|---|
| `get_viewport` | Aktueller Zustand des Editors (JSON) |
| `get_user_selection` | Was der User im Browser ausgewählt hat |
| `get_user_input` | Nachrichten die der User im Browser getippt hat |
| `update_scene` | Scene-State aktualisieren (pushed an Browser) |
| `send_command` | Befehl an den Browser senden |
| `open_url` | Editor-URL anzeigen |
| `take_screenshot` | Screenshot des Canvas als PNG (via Puppeteer) |
| `save_scene` | Scene als JSON speichern |
| `load_scene` | Scene aus JSON laden |

## Motion Adapter Tools

| Tool | Beschreibung |
|---|---|
| `add_element` | Element hinzufügen (text, shape, image, svg) |
| `update_element` | Element-Properties ändern |
| `remove_element` | Element entfernen |
| `duplicate_element` | Element klonen mit Offset |
| `reorder_element` | Z-Index ändern (up/down/top/bottom) |
| `add_keyframe` | Keyframe-Animation hinzufügen |
| `set_timeline` | Play, Pause, Seek, Reset |
| `set_scene` | Scene-Einstellungen (Background, Dimensions, Duration) |
| `list_elements` | Alle Elemente auflisten |

## Starten

```bash
# Als MCP-Server (stdio) + Visual Server (HTTP)
node server.js

# Mit spezifischem Adapter und Port
VISUAL_MCP_ADAPTER=motion VISUAL_MCP_PORT=4200 node server.js
```

## MCP-Konfiguration (Claude Code)

In `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "visual-mcp": {
      "command": "node",
      "args": ["C:/Users/hmk/promptheus/visual-mcp/server.js"],
      "env": {
        "VISUAL_MCP_ADAPTER": "motion",
        "VISUAL_MCP_PORT": "4200"
      }
    }
  }
}
```

## Browser-Interaktion

- **Klick** auf Element → Auswahl (orange Outline)
- **Drag** auf ausgewähltem Element → Verschieben
- **Doppelklick** auf Text → Inline-Editing
- **Input-Bar** unten → Nachricht an Claude senden
- **Timeline** → Keyframes sehen, Klick auf Ruler = Seek
- **Properties-Panel** rechts → Werte direkt ändern
- **Scroll-Rad** → Canvas zoomen
- **Alt+Drag / Mitte-Klick** → Canvas pannen

### Keyboard Shortcuts

| Taste | Aktion |
|---|---|
| `Space` | Play/Pause |
| `Delete` / `Backspace` | Ausgewähltes Element löschen |
| `Arrow Keys` | Element um 1px verschieben (Shift = 10px) |
| `Escape` | Auswahl aufheben |
| `F` | Canvas einpassen (Fit) |

## Render-Endpoint

`GET /render?t=<ms>` — Sauberer Canvas ohne UI-Chrome. Für Screenshots und Export.

## Neuen Adapter erstellen

1. Ordner in `adapters/<name>/` anlegen
2. `index.js` mit diesen Exports:
   - `name` — String
   - `description` — String
   - `initialScene()` — gibt initialen State zurück
   - `registerTools(server, bus, state)` — MCP-Tools registrieren
   - `handleHttp(action, body, state)` — HTTP-API für adapter-spezifische Endpunkte

Alle Interaktionen werden via WebSocket an den Server gemeldet und sind über MCP-Tools abrufbar.
