(function () {
  const consoleRoot = document.querySelector(".console");
  const header = consoleRoot.querySelector(".console-header");
  const logContainer = document.getElementById("log_content");
  const input = consoleRoot.querySelector("textarea");

  function scrollBottom() { logContainer.scrollTop = logContainer.scrollHeight; }

  function sanitizeMessage(msg) {
    if (typeof msg === "string") {
      if (msg.includes(".inverse() has been renamed to invert()")) return null;
      return msg.replace(/\bTHREE\b/g, "MESHFIELD");
    }
    return msg;
  }

  function addLine(text, type = "log") {
    text = sanitizeMessage(text);
    if (text === null) return;

    const line = document.createElement("div");
    const colors = { log: "#e0e0e0", error: "#ff5f5f", warn: "#ffb347", result: "#7aff7a", command: "#8f8f8f", info: "#8fbaff" };
    line.textContent = text;
    line.style.color = colors[type] || "#e0e0e0";
    line.style.marginBottom = "2px";
    line.style.whiteSpace = "pre-wrap";
    line.style.wordBreak = "break-word";

    logContainer.appendChild(line);
    scrollBottom();
  }

  const nativeConsole = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...args) => { args.forEach(a => addLine(String(a), "log")); nativeConsole.log(...args); };
  console.warn = (...args) => { args.forEach(a => addLine(String(a), "warn")); nativeConsole.warn(...args); };
  console.error = (...args) => { args.forEach(a => addLine(String(a), "error")); nativeConsole.error(...args); };

  window.onerror = (msg, url, line, col, err) => addLine(`${msg} (at ${line}:${col})`, "error");
  window.onunhandledrejection = e => addLine(`Unhandled Promise Rejection: ${e.reason}`, "error");

  function run(code) {
    if (!code.trim()) return;
    const safeCode = code.replace(/\bTHREE\b/g, "MESHFIELD");
    addLine("> " + code, "command");
    try { const result = eval(safeCode); if (result !== undefined) addLine(String(result), "result"); }
    catch (e) { addLine(e.toString(), "error"); }
  }

  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const cmd = input.value;
      input.value = "";
      input.style.height = "auto";
      run(cmd);
    }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 60) + "px";
  });

  // =======================
  // Drag pelo header
  // =======================
  let isDragging = false, offsetX, offsetY;

  function dragStart(x, y) {
    isDragging = true;
    offsetX = x - consoleRoot.offsetLeft;
    offsetY = y - consoleRoot.offsetTop;
  }

  function dragMove(x, y) {
    if (!isDragging) return;
    let left = x - offsetX;
    let top = y - offsetY;
    left = Math.max(0, Math.min(left, window.innerWidth - consoleRoot.offsetWidth));
    top = Math.max(0, Math.min(top, window.innerHeight - consoleRoot.offsetHeight));
    consoleRoot.style.left = left + "px";
    consoleRoot.style.top = top + "px";
  }

  function dragEnd() { isDragging = false; }

  header.addEventListener("mousedown", e => dragStart(e.clientX, e.clientY));
  document.addEventListener("mousemove", e => dragMove(e.clientX, e.clientY));
  document.addEventListener("mouseup", dragEnd);

  header.addEventListener("touchstart", e => {
    const t = e.touches[0];
    dragStart(t.clientX, t.clientY);
  }, { passive: true });

  document.addEventListener("touchmove", e => {
    const t = e.touches[0];
    // Só previne se estiver arrastando
    if (isDragging) {
      e.preventDefault();
      dragMove(t.clientX, t.clientY);
    }
  }, { passive: false });

  document.addEventListener("touchend", dragEnd);

  // =======================
  // Redimensionar canto inferior direito
  // =======================
  const resizer = document.createElement("div");
  resizer.style.width = "12px";
  resizer.style.height = "12px";
  resizer.style.position = "absolute";
  resizer.style.right = "2px";
  resizer.style.bottom = "2px";
  resizer.style.cursor = "nwse-resize";
  resizer.style.background = "#555";
  resizer.style.borderRadius = "2px";
  consoleRoot.style.position = "fixed";
  consoleRoot.appendChild(resizer);

  let isResizing = false, startX, startY, startWidth, startHeight;

  function resizeStart(x, y) {
    isResizing = true;
    startX = x;
    startY = y;
    startWidth = consoleRoot.offsetWidth;
    startHeight = consoleRoot.offsetHeight;
  }

  function resizeMove(x, y) {
    if (!isResizing) return;
    let newWidth = startWidth + (x - startX);
    let newHeight = startHeight + (y - startY);
    newWidth = Math.max(200, newWidth);
    newHeight = Math.max(100, newHeight);
    newWidth = Math.min(newWidth, window.innerWidth - consoleRoot.offsetLeft);
    newHeight = Math.min(newHeight, window.innerHeight - consoleRoot.offsetTop);
    consoleRoot.style.width = newWidth + "px";
    consoleRoot.style.height = newHeight + "px";
  }

  function resizeEnd() { isResizing = false; }

  resizer.addEventListener("mousedown", e => { e.stopPropagation(); resizeStart(e.clientX, e.clientY); });
  document.addEventListener("mousemove", e => resizeMove(e.clientX, e.clientY));
  document.addEventListener("mouseup", resizeEnd);

  resizer.addEventListener("touchstart", e => { e.stopPropagation(); const t = e.touches[0]; resizeStart(t.clientX, t.clientY); }, { passive: false });
  document.addEventListener("touchmove", e => { const t = e.touches[0]; resizeMove(t.clientX, t.clientY); }, { passive: false });
  document.addEventListener("touchend", resizeEnd);

  // Fechar botão
  const btnClose = header.querySelector("button");
  btnClose.addEventListener("click", () => { consoleRoot.style.display = "none"; });

  window.EditorConsole = { clear() { logContainer.innerHTML = ""; }, run, log: console.log, warn: console.warn, error: console.error };

  addLine("Console iniciado.", "info");
  addLine("Shift + Enter → nova linha", "info");

})();