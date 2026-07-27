# Discord-Klon (Electron)

Erste lokale Version: Login/Registrierung, Avatar & Banner (Bild oder GIF),
seltene Kurz-Benutzernamen, Themes, Server/Channel-Oberfläche.

## Starten

1. Node.js installieren (falls noch nicht vorhanden): https://nodejs.org
2. Im Projektordner:
   ```
   npm install
   npm start
   ```

## Was schon geht
- Registrierung mit frei wählbarem Passwort
- Benutzername-Seltenheit: je kürzer der Name, desto seltener (Legendär/Episch/Selten/Ungewöhnlich/Gewöhnlich),
  live-Anzeige beim Tippen im Registrierungsformular
- Avatar & Banner hochladen (Banner unterstützt auch GIF)
- 3 Themes: Dunkel, Hell, Mitternacht
- Server/Channel-Oberfläche mit lokalem Chat (nur du selbst, ohne echten Server)

## Noch nicht enthalten (kommt später)
- Mehrere echte Nutzer / echter Server-Betrieb (WebSockets)
- Echte Direktnachrichten zwischen Nutzern
- Mehrere Server anlegen (Server-Liste ist aktuell nur "Persönlicher Server")

## Struktur
- `main.js` — Electron-Hauptprozess, IPC-Handler
- `preload.js` — sichere Brücke zwischen Renderer und Hauptprozess
- `src/db.js` — einfache JSON-Datenbank für Nutzerkonten
- `src/auth.js` — Registrierung/Login, Passwort-Hashing (bcrypt)
- `src/rarity.js` — Seltenheits-Logik für Benutzernamen
- `renderer/` — Login-Screen und Hauptansicht (HTML/CSS/JS)
