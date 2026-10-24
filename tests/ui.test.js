const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const root = path.join(__dirname, "..");
const KEY = "super-bowl-lvii-sheet-v1";
function page(saved, storageFails = false) {
  const dom = new JSDOM(fs.readFileSync(path.join(root,"index.html"),"utf8"),
    { url:"https://sheet.example/", runScripts:"outside-only" });
  const w = dom.window;
  if (saved !== undefined) w.localStorage.setItem(KEY, saved);
  w.confirm = () => true;
  w.prompt = () => null;
  w.URL.createObjectURL = () => "blob:backup";
  w.URL.revokeObjectURL = () => {};
  if (storageFails) w.Storage.prototype.setItem = () => { throw new Error("Quota exceeded"); };
  w.eval(fs.readFileSync(path.join(root,"core.js"),"utf8"));
  w.eval(fs.readFileSync(path.join(root,"app.js"),"utf8"));
  const get = id => w.document.getElementById(id);
  const change = (id,value) => { get(id).value=value; get(id).dispatchEvent(new w.Event("change",{bubbles:true})); };
  const add = name => { get("name").value=name; get("add-participant").dispatchEvent(new w.Event("submit",{bubbles:true,cancelable:true})); };
  return { dom, w, get, change, add, saved:() => w.localStorage.getItem(KEY), close:() => w.close() };
}

test("all 25 named controls render, including independent questions 22 and 23", () => {
  const p = page();
  try {
    assert.equal(p.w.document.querySelectorAll("#questions select").length,25);
    assert.equal(p.w.document.querySelectorAll("#questions select[name]").length,25);
    assert.ok(p.get("answer-jerrick-mckinnon"));
    assert.ok(p.get("answer-isiah-pacheco"));
    assert.ok([...p.w.document.querySelectorAll("#questions select")].every(s=>s.disabled && s.value===""));
  } finally { p.close(); }
});

test("picks and manual results save, score correctly, and survive reload", () => {
  let raw;
  const p = page();
  try {
    p.add("Alice");
    p.change("answer-coin-toss","heads");
    p.change("answer-first-quarter","tie");
    p.get("results-tab").click();
    p.change("answer-coin-toss","heads");
    p.change("answer-first-quarter","tie");
    p.change("answer-travis-kelce","void");
    assert.equal(p.get("score").textContent,"2 / 2 correct");
    raw=p.saved();
    const state=JSON.parse(raw);
    assert.equal(state.entries[0].picks["coin-toss"],"heads");
    assert.equal(state.results["travis-kelce"],"void");
  } finally { p.close(); }
  const reloaded=page(raw);
  try {
    assert.equal(reloaded.get("participant").selectedOptions[0].textContent,"Alice");
    assert.equal(reloaded.get("answer-coin-toss").value,"heads");
    assert.equal(reloaded.get("score").textContent,"2 / 2 correct");
    assert.match(reloaded.get("settled").textContent,/1 void/);
  } finally { reloaded.close(); }
});

test("participant entries stay isolated and duplicate names are rejected", () => {
  const p=page();
  try {
    p.add("Alice"); const alice=p.get("participant").value;
    p.change("answer-coin-toss","heads");
    p.add("Bob");
    assert.equal(p.get("answer-coin-toss").value,"");
    p.add(" ALICE ");
    assert.match(p.get("status").textContent,/already in use/);
    assert.equal(p.get("participant").options.length,2);
    p.change("participant",alice);
    assert.equal(p.get("answer-coin-toss").value,"heads");
  } finally { p.close(); }
});

test("names are displayed as text, never markup", () => {
  const p=page();
  try {
    const name="<img src=x onerror=alert(1)>";
    p.add(name);
    assert.ok(p.get("leaderboard").textContent.includes(name));
    assert.equal(p.get("leaderboard").querySelectorAll("img").length,0);
  } finally { p.close(); }
});

test("remove and reset respect cancellation", () => {
  const p=page();
  try {
    p.add("Alice");
    p.w.confirm=()=>false;
    p.get("remove").click();
    p.get("reset").click();
    assert.equal(p.get("participant").options.length,1);
    assert.equal(JSON.parse(p.saved()).entries.length,1);
    p.w.confirm=()=>true;
    p.get("reset").click();
    assert.equal(JSON.parse(p.saved()).entries.length,0);
  } finally { p.close(); }
});

test("corrupt saved data is preserved until explicit replacement", () => {
  const p=page("{invalid json");
  try {
    p.add("Alice");
    assert.equal(p.saved(),"{invalid json");
    assert.equal(p.get("storage-warning").hidden,false);
    assert.match(p.get("status").textContent,/tab only/);
    p.get("reset").click();
    assert.equal(JSON.parse(p.saved()).entries.length,0);
  } finally { p.close(); }
});

test("quota failures keep the page usable and show backup warning", () => {
  const p=page(undefined,true);
  try {
    p.add("Alice");
    p.change("answer-coin-toss","tails");
    assert.equal(p.get("answer-coin-toss").value,"tails");
    assert.equal(p.get("storage-warning").hidden,false);
    assert.match(p.get("storage-warning").textContent,/Export/);
  } finally { p.close(); }
});

async function importData(p, text) {
  Object.defineProperty(p.get("import"),"files",{ configurable:true,value:[{size:text.length,text:async()=>text}] });
  p.get("import").dispatchEvent(new p.w.Event("change",{bubbles:true}));
  await new Promise(resolve=>setTimeout(resolve,0));
}
test("invalid import leaves current data unchanged; valid import requires replacement confirmation", async () => {
  const p=page();
  try {
    p.add("Alice"); const original=p.saved();
    await importData(p,'{"version":99}');
    assert.equal(p.saved(),original);
    assert.match(p.get("status").textContent,/Import failed/);
    const other=p.w.SuperBowlSheet.createState();
    p.w.SuperBowlSheet.addEntry(other,"Bob","bob");
    p.w.confirm=()=>false;
    await importData(p,JSON.stringify(other));
    assert.equal(p.saved(),original);
    p.w.confirm=()=>true;
    await importData(p,JSON.stringify(other));
    assert.equal(JSON.parse(p.saved()).entries[0].name,"Bob");
  } finally { p.close(); }
});
