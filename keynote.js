/*
  Keynote Custom Module (OS + JXA + WebSocket Return)
  Executes Apple Keynote JXA commands non-blocking via osascript and sends
  a JSON payload of slide details to a Chataigne WebSocket Server.
*/

var pollTimer = 0.0;

function init()
{
	pollTimer = 0.0;
}

function update(deltaTime)
{
	if (!local.parameters.autoPoll.get()) return;

	pollTimer += deltaTime;
	var interval = local.parameters.pollInterval.get();
	if (interval < 0.1) interval = 0.1;

	if (pollTimer >= interval)
	{
		pollTimer = 0.0;
		runKeynoteAction("status", "");
	}
}

function moduleParameterChanged(param)
{
	if (param.name == "refreshStatus")
	{
		refreshStatus();
	}
}

function processDataReceived(data, command)
{
	if (data && data.length > 0)
	{
		script.log("Keynote output: " + data);
	}
}

function nextSlide()
{
	runKeynoteAction("next", "");
}

function previousSlide()
{
	runKeynoteAction("previous", "");
}

function gotoSlide(slideNumber)
{
	runKeynoteAction("goto", "" + parseInt(slideNumber));
}

function startPresentation(fromCurrent)
{
	runKeynoteAction("start", fromCurrent ? "1" : "0");
}

function stopPresentation()
{
	runKeynoteAction("stop", "");
}

function refreshStatus()
{
	runKeynoteAction("status", "");
}

function toHex(str)
{
	var digits = "0123456789abcdef";
	var hex = "";
	for (var i = 0; i < str.length; i++)
	{
		var code = str.charCodeAt(i);
		hex += digits.charAt((code >> 4) & 0x0f) + digits.charAt(code & 0x0f);
	}
	return hex;
}

function jsQuote(str)
{
	var out = '"';
	for (var i = 0; i < str.length; i++)
	{
		var ch = str.charAt(i);
		if (ch == '\\') out += '\\\\';
		else if (ch == '"') out += '\\"';
		else if (ch == '\n') out += '\\n';
		else if (ch == '\r') out += '\\r';
		else if (ch == '\t') out += '\\t';
		else out += ch;
	}
	return out + '"';
}

function buildJxaScript(action, arg)
{
	var lines = [
		'var action = ' + jsQuote(action) + ';',
		'var arg = ' + jsQuote(arg) + ';',
		'var kn = Application("Keynote");',
		'var res = { ok: true, action: action, running: kn.running(), playing: false, documentName: "", totalSlides: 0, slideNumber: 0, slideTitle: "", slideNotes: "", skipped: false, error: "" };',
		'try {',
		'  if (res.running && kn.documents.length > 0) {',
		'    var doc = kn.documents[0];',
		'    if (action === "next") { kn.showNext(); delay(0.05); }',
		'    else if (action === "previous") { kn.showPrevious(); delay(0.05); }',
		'    else if (action === "start") { if (arg === "1") { doc.start({ from: doc.currentSlide() }); } else { kn.start(doc); } delay(0.05); }',
		'    else if (action === "stop") { kn.stop(); delay(0.05); }',
		'    else if (action === "goto") {',
		'      var n = parseInt(arg, 10);',
		'      var matches = doc.slides.whose({ slideNumber: n });',
		'      if (matches && matches.length > 0) { doc.currentSlide = matches[0]; delay(0.05); }',
		'      else { res.ok = false; res.error = "Slide number not found"; }',
		'    }',
		'    res.playing = !!kn.playing();',
		'    res.documentName = doc.name() || "";',
		'    res.totalSlides = doc.slides.length;',
		'    var s = doc.currentSlide();',
		'    if (s) {',
		'      res.slideNumber = s.slideNumber();',
		'      res.skipped = !!s.skipped();',
		'      try { res.slideNotes = s.presenterNotes() || ""; } catch (e) {}',
		'      try { res.slideTitle = s.defaultTitleItem().objectText() || ""; } catch (e) {}',
		'      try {',
		'        var shapes = s.shapes();',
		'        for (var si = 0; si < shapes.length; si++) {',
		'          try {',
		'            var txt = shapes[si].objectText();',
		'            if (txt) {',
		'              var sep = txt.indexOf("|||||");',
		'              if (sep !== -1) {',
		'                var k = txt.substring(0, sep).trim();',
		'                var v = txt.substring(sep + 5).trim();',
		'                if (k.length > 0) { res[k] = v; }',
		'              }',
		'            }',
		'          } catch (se) {}',
		'        }',
		'      } catch (e) {}',
		'    }',
		'  } else if (!res.running) {',
		'    res.ok = false; res.error = "Keynote is not running";',
		'  } else {',
		'    res.ok = false; res.error = "No Keynote document open";',
		'  }',
		'} catch (err) {',
		'  res.ok = false;',
		'  res.error = "" + err;',
		'}',
		'JSON.stringify(res);'
	];
	var out = "";
	for (var i = 0; i < lines.length; i++)
	{
		if (i > 0) out += " ";
		out += lines[i];
	}
	return out;
}

function runKeynoteAction(action, arg)
{
	var wsUrl = local.parameters.webSocketURL.get();
	if (!wsUrl || wsUrl === "") wsUrl = "ws://127.0.0.1:8080";

	script.log("Keynote -> " + action + (arg !== "" ? " (" + arg + ")" : ""));

	var jxaHex = toHex(buildJxaScript(action, arg));
	var wsHex = toHex(wsUrl);

	var pyLines = [
		"import sys, subprocess, socket, os, base64, urllib.parse as u",
		"jxa = bytes.fromhex(sys.argv[2]).decode('utf-8')",
		"ws = bytes.fromhex(sys.argv[3]).decode('utf-8')",
		"proc = subprocess.run(['/usr/bin/osascript', '-l', 'JavaScript', '-e', jxa], capture_output=True, text=True)",
		"if proc.returncode != 0:",
		"    print('JXA_ERR: ' + proc.stderr.strip(), flush=True)",
		"p = proc.stdout.strip().encode('utf-8')",
		"if p:",
		"    try:",
		"        r = u.urlparse(ws)",
		"        s = socket.create_connection((r.hostname or '127.0.0.1', r.port or 80), 2)",
		"        k = base64.b64encode(os.urandom(16)).decode()",
		"        req = ('GET ' + (r.path or '/') + ' HTTP/1.1\\r\\nHost: ' + r.netloc + '\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Key: ' + k + '\\r\\nSec-WebSocket-Version: 13\\r\\n\\r\\n').encode()",
		"        s.sendall(req)",
		"        s.recv(4096)",
		"        m = os.urandom(4)",
		"        n = len(p)",
		"        if n < 126: h = bytes([0x81, 0x80 | n])",
		"        elif n < 65536: h = bytes([0x81, 0xfe]) + n.to_bytes(2, 'big')",
		"        else: h = bytes([0x81, 0xff]) + n.to_bytes(8, 'big')",
		"        s.sendall(h + m + bytes(b ^ m[i % 4] for i, b in enumerate(p)))",
		"        cm = os.urandom(4)",
		"        s.sendall(bytes([0x88, 0x82]) + cm + bytes(b ^ cm[i % 4] for i, b in enumerate(b'\\x03\\xe8')))",
		"        s.settimeout(0.2)",
		"        try: s.recv(64)",
		"        except Exception: pass",
		"        s.close()",
		"    except Exception as ex:",
		"        print('WS_ERR: ' + str(ex), flush=True)"
	];
	var pyCode = "";
	for (var i = 0; i < pyLines.length; i++)
	{
		if (i > 0) pyCode += "\n";
		pyCode += pyLines[i];
	}

	var pyHex = toHex(pyCode);
	var bootHex = toHex("import sys;exec(bytes.fromhex(sys.argv[1]).decode())");
	// JUCE ChildProcess::start(String) passes tokens directly to execvp without stripping quotes.
	// Keep the -c argument free of spaces and double-quotes so it executes as-is.
	var fullCmd = "/usr/bin/python3 -c exec(bytes.fromhex('" + bootHex + "').decode()) " + pyHex + " " + jxaHex + " " + wsHex;

	// Non-blocking execution on OSModule's background thread
	local.launchProcess(fullCmd, 0);
}
