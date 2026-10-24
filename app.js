(() => {
  "use strict";
  const C = window.SuperBowlSheet;
  const KEY = "super-bowl-lvii-sheet-v1";
  const $ = id => document.getElementById(id);
  let state = C.createState(), selectedId = "", mode = "picks", storageBlocked = false;
  let hadStoredData = false;
  function message(text, error = false) {
    $("status").textContent = text;
    $("status").classList.toggle("error", error);
  }
  function warn(text) { $("storage-warning").hidden = false; $("storage-warning").textContent = text; }
  try {
    const raw = localStorage.getItem(KEY);
    hadStoredData = raw !== null;
    if (raw) state = C.validateState(JSON.parse(raw));
  } catch (error) {
    storageBlocked = true;
    warn("Saved data could not be read. Changes will stay only in this tab. Export a backup before closing. Import or reset to explicitly replace saved data.");
  }
  selectedId = state.entries[0]?.id || "";
  function persist() {
    if (storageBlocked) {
      message("Changes kept in this tab only. Export a backup.", true);
      return;
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      hadStoredData = true;
      $("storage-warning").hidden = true;
      message("Saved in this browser.");
    } catch (error) {
      warn("Browser storage is unavailable or full. Export a JSON backup to keep your changes.");
      message("Changes kept in this tab only.", true);
    }
  }
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function selectedEntry() { return state.entries.find(entry => entry.id === selectedId); }
  function render() {
    const focusId = document.activeElement?.id;
    const chooser = $("participant");
    chooser.replaceChildren();
    if (!state.entries.length) chooser.append(new Option("Add a participant to begin", ""));
    for (const entry of state.entries) chooser.append(new Option(entry.name, entry.id));
    chooser.value = selectedId;
    chooser.disabled = !state.entries.length;
    $("rename").disabled = !selectedEntry();
    $("remove").disabled = !selectedEntry();
    $("picks-tab").setAttribute("aria-pressed", String(mode === "picks"));
    $("results-tab").setAttribute("aria-pressed", String(mode === "results"));
    const current = selectedEntry();
    $("sheet-title").textContent = mode === "results" ? "Actual outcomes" :
      current ? current.name + " — predictions" : "Your predictions";
    $("sheet-help").textContent = mode === "results" ?
      "Enter known results manually. Pending results do not count; voided questions are excluded." :
      "Choose each prediction. Unanswered questions stay blank. Each correct settled answer earns one point.";
    const stats = C.score(current || { picks: {} }, state.results);
    $("answered").textContent = current ? stats.answered + " / 25 picks" : "No participant";
    $("settled").textContent = stats.settled + " settled · " + stats.pending + " pending · " + stats.voided + " void";
    $("score").textContent = current ? stats.correct + " / " + stats.settled + " correct" : "Add your name to start";
    const list = $("questions");
    list.replaceChildren();
    for (const [index, question] of C.QUESTIONS.entries()) {
      const card = element("div", undefined, "question");
      const label = element("label", (index + 1) + ". " + question.label);
      const id = "answer-" + question.id;
      label.htmlFor = id;
      const select = document.createElement("select");
      select.id = id;
      select.name = (mode === "results" ? "results" : "picks") + "[" + question.id + "]";
      select.dataset.question = question.id;
      select.append(new Option(mode === "results" ? "Pending" : "Choose an answer…", ""));
      for (const option of question.options) select.append(new Option(option.label, option.value));
      if (mode === "results") select.append(new Option("Void / not applicable", "void"));
      const value = mode === "results" ? state.results[question.id] || "" : current?.picks[question.id] || "";
      select.value = value;
      select.disabled = mode === "picks" && !current;
      const printed = element("span", select.selectedOptions[0]?.textContent || "Unanswered", "print-answer");
      const result = state.results[question.id];
      let detail = "Result pending";
      if (result === "void") detail = "Voided — excluded from scoring";
      else if (result && mode === "picks") {
        const answerLabel = question.options.find(option => option.value === result)?.label;
        detail = (value === result ? "Correct" : value ? "Incorrect" : "Unanswered") + " · Result: " + answerLabel;
      } else if (result) detail = "Settled";
      card.append(label, select, printed, element("small", detail));
      list.append(card);
    }
    const body = $("leaderboard");
    body.replaceChildren();
    const rows = C.leaderboard(state);
    if (!rows.length) {
      const row = document.createElement("tr"), cell = element("td", "Add participants to see the leaderboard.");
      cell.colSpan = 4; row.append(cell); body.append(row);
    }
    for (const item of rows) {
      const row = document.createElement("tr");
      if (item.id === selectedId) row.className = "current";
      for (const value of [item.rank, item.name, item.correct + " / " + item.settled, item.answered + " / 25"])
        row.append(element("td", String(value)));
      body.append(row);
    }
    if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  }
  $("add-participant").addEventListener("submit", event => {
    event.preventDefault();
    try {
      const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() :
        "entry-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
      selectedId = C.addEntry(state, $("name").value, id).id;
      $("name").value = "";
      mode = "picks"; persist(); render();
    } catch (error) { message(error.message, true); }
  });
  $("participant").addEventListener("change", event => { selectedId = event.target.value; render(); });
  $("rename").addEventListener("click", () => {
    const current = selectedEntry();
    if (!current) return;
    const value = window.prompt("Participant name", current.name);
    if (value === null) return;
    try {
      const name = C.normalizeName(value);
      if (state.entries.some(entry => entry.id !== current.id && C.nameKey(entry.name) === C.nameKey(name)))
        throw new Error("That participant name is already in use.");
      current.name = name; persist(); render();
    } catch (error) { message(error.message, true); }
  });
  $("remove").addEventListener("click", () => {
    const current = selectedEntry();
    if (!current || !window.confirm("Remove " + current.name + " and all of their predictions?")) return;
    state.entries = state.entries.filter(entry => entry.id !== current.id);
    selectedId = state.entries[0]?.id || "";
    persist(); render();
  });
  $("picks-tab").addEventListener("click", () => { mode = "picks"; render(); });
  $("results-tab").addEventListener("click", () => { mode = "results"; render(); });
  $("questions").addEventListener("change", event => {
    const id = event.target.dataset.question;
    if (!id) return;
    const target = mode === "results" ? state.results : selectedEntry()?.picks;
    if (!target) return;
    if (event.target.value) target[id] = event.target.value;
    else delete target[id];
    persist(); render();
  });
  function download(content, type, name) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement("a");
    link.href = url; link.download = name;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $("export").addEventListener("click", () =>
    download(JSON.stringify(state, null, 2), "application/json", "super-bowl-lvii-sheet.json"));
  $("csv").addEventListener("click", () =>
    download(C.leaderboardCsv(state), "text/csv;charset=utf-8", "super-bowl-lvii-scores.csv"));
  $("print").addEventListener("click", () => window.print());
  $("import").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error("Choose a JSON backup smaller than 1 MB.");
      const imported = C.validateState(JSON.parse(await file.text()));
      if ((hadStoredData || state.entries.length || Object.keys(state.results).length) &&
          !window.confirm("Replace this entire sheet with the imported backup? Export your current sheet first if you want to keep it.")) return;
      state = imported; selectedId = state.entries[0]?.id || ""; storageBlocked = false;
      persist(); render();
    } catch (error) { message("Import failed: " + error.message, true); }
    finally { event.target.value = ""; }
  });
  $("reset").addEventListener("click", () => {
    if (!window.confirm("Delete all participants, predictions, and results from this browser? Export a backup first to keep a copy.")) return;
    state = C.createState(); selectedId = ""; storageBlocked = false;
    persist(); render();
  });
  render();
})();
