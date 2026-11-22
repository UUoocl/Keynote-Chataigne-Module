# Keynote Custom Module (OS + JXA + WebSocket Return)

A Chataigne custom module based on the `OS` module that controls Apple Keynote via JXA (`osascript -l JavaScript`) non-blocking and returns a JSON payload of slide details over WebSocket.

## Architecture

```
Chataigne (Apple Shortcuts / OS Module)
  │  local.launchProcess(fullCmd, 0)  [non-blocking background thread]
  ▼
/usr/bin/python3  (hex-encoded bootstrap & packed args)
  ├──▶ /usr/bin/shortcuts run  
  │         └── captures stdout & parses JSON if valid
  └──▶ WebSocket client (stdlib socket)
            └── sends JSON text frame + Close frame
                  ▼
Chataigne (WebSocket Server, Protocol: JSON)
  └── parses JSON into live Chataigne Values
```

1. **Non-blocking execution**: `keynote.js` calls `local.launchProcess(..., 0)` so `OSModule` runs commands on its background thread without pausing Chataigne's UI.
2. **Shell-free `ChildProcess` invocation**: JUCE's `ChildProcess::start()` tokenizes commands without a shell and passes tokens directly to `execvp`. The JXA script and WebSocket URL are hex-encoded and passed to a space-free, double-quote-free Python 3 bootstrap.
3. **WebSocket return**: Python sends the JSON output from `osascript` over a local WebSocket connection (using only Python's standard library) followed by a masked RFC-6455 Close frame, avoiding JXA `NSURLSessionWebSocketTask` teardown crashes.

## Requirements: Python 3 & Xcode Command Line Tools

`keynote.js` invokes `/usr/bin/python3` and uses **only Python 3 standard-library modules** (no `pip` packages needed).

### Option A: Install Xcode Command Line Tools (macOS default `/usr/bin/python3`)
On macOS, `/usr/bin/python3` is provided by **Xcode Command Line Tools** (full Xcode is not required):

```bash
xcode-select --install
```

If you previously had full `Xcode.app` installed and later uninstalled it, point `xcode-select` to Command Line Tools:

```bash
sudo xcode-select --switch /Library/Developer/CommandLineTools
```

### Option B: Use a Custom Python 3 Path
If you prefer a different Python 3 installation (e.g. Homebrew `/opt/homebrew/bin/python3` or python.org `/Library/Frameworks/Python.framework/Versions/Current/bin/python3`), update `/usr/bin/python3` in `keynote.js` (`runKeynoteAction`):

```js
var fullCmd = "/opt/homebrew/bin/python3 -c exec(bytes.fromhex('" + bootHex + "').decode()) " + pyHex + " " + jxaHex + " " + wsHex;
```

## Installation

Copy or symlink this folder into Chataigne's custom modules directory:

```bash
ln -s "$(pwd)/custom modules/Keynote" ~/Documents/Chataigne/modules/Keynote
```

(Or place it in a `modules/Keynote` folder next to your `.noisette` project file.)

## Setup in Chataigne

1. Add **Protocol → WebSocket Server**:
   - Set **Local Port** (e.g. `8080`).
   - Set **Protocol** to `JSON`.
2. Add **Software → Keynote**:
   - Set **WebSocket URL** to `ws://127.0.0.1:8080` (matching the WebSocket Server port).
   - Optionally enable **Auto Poll** and set **Poll Interval** (seconds).

## Commands

- **Next Slide**
- **Previous Slide**
- **Go to Slide** (`Slide Number`)
- **Start Presentation** (`From Current Slide`)
- **Stop Presentation**
- **Get Slide Info**

## Returned JSON Payload (via WebSocket)

Every command sends a JSON object to the configured WebSocket Server:

```json
{
  "ok": true,
  "action": "status",
  "running": true,
  "playing": false,
  "documentName": "Presentation.key",
  "totalSlides": 12,
  "slideNumber": 3,
  "slideTitle": "Agenda",
  "slideNotes": "Speaker notes for slide 3",
  "skipped": false,
  "error": "",
  "Scene": "Over-The-Shoulder"
}
```

Any shape on the current slide whose text contains `|||||` is split at the first `|||||` delimiter—text before it becomes a JSON key and text after it becomes its string value in the payload.
