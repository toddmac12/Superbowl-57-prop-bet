const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../core.js");

test("all 25 original question IDs are present with valid normalized options", () => {
  assert.equal(C.QUESTIONS.length, 25);
  assert.equal(new Set(C.QUESTIONS.map(q => q.id)).size, 25);
  for (const q of C.QUESTIONS) {
    assert.ok(q.label);
    assert.ok(q.options.length >= 2);
    assert.equal(new Set(q.options.map(o => o.value)).size, q.options.length);
    for (const o of q.options) assert.match(o.value, /^[a-z]+$/);
  }
  for (const id of ["first-field-goal", "score-first"])
    assert.deepEqual(C.QUESTIONS.find(q => q.id === id).options.map(o => o.value), ["eagles", "chiefs"]);
  for (const id of ["first-quarter", "highest-scoring-half"])
    assert.ok(C.QUESTIONS.find(q => q.id === id).options.some(o => o.value === "tie"));
});

test("new participants have no preselected predictions", () => {
  const state = C.createState();
  const entry = C.addEntry(state, " Alice ", "alice");
  assert.equal(entry.name, "Alice");
  assert.deepEqual(entry.picks, {});
  assert.deepEqual(C.score(entry, {}), { correct:0, settled:0, answered:0, voided:0, possible:25, pending:25 });
});

test("scoring excludes pending and void outcomes; blanks never earn points", () => {
  const entry = { picks: { "coin-toss":"heads", "first-quarter":"tie", "first-score":"chiefs" } };
  const result = C.score(entry, { "coin-toss":"heads", "first-quarter":"tie", "first-score":"void", "travis-kelce":"yes" });
  assert.deepEqual(result, { correct:2, settled:3, answered:3, voided:1, possible:24, pending:21 });
  assert.equal(C.score({picks:{}}, {"coin-toss":"tails"}).correct, 0);
});

test("leaders share competition ranks on tied scores", () => {
  const state = C.createState();
  C.addEntry(state, "Bob", "b").picks["coin-toss"] = "heads";
  C.addEntry(state, "Alice", "a").picks["coin-toss"] = "heads";
  C.addEntry(state, "Carol", "c").picks["coin-toss"] = "tails";
  state.results["coin-toss"] = "heads";
  assert.deepEqual(C.leaderboard(state).map(x => [x.name,x.rank]), [["Alice",1],["Bob",1],["Carol",3]]);
});

test("backup round trip preserves all picks and results", () => {
  const state = C.createState();
  const entry = C.addEntry(state, "Alice", "alice");
  for (const question of C.QUESTIONS) entry.picks[question.id] = question.options[0].value;
  state.results["coin-toss"] = "tails";
  state.results["first-quarter"] = "void";
  assert.deepEqual(C.validateState(JSON.parse(JSON.stringify(state))), state);
});

test("imports reject incompatible, malformed, duplicate, or excessive data", () => {
  const good = C.createState();
  const cases = [null, [], {}, {...good,version:2}, {...good,event:"other"},
    {...good,entries:[{id:"x",name:"A",picks:{"unknown":"yes"}}]},
    {...good,results:{"coin-toss":"chiefs"}},
    {...good,entries:[{id:"x",name:"A",picks:{"coin-toss":"void"}}]},
    {...good,entries:[{id:"x",name:"A",picks:{}},{id:"x",name:"B",picks:{}}]},
    {...good,entries:[{id:"x",name:"Alice",picks:{}},{id:"y",name:"alice",picks:{}}]},
    {...good,entries:[{id:"<script>",name:"A",picks:{}}]},
    {...good,entries:new Array(501).fill({id:"x",name:"A",picks:{}})}];
  for (const bad of cases) assert.throws(() => C.validateState(bad));
});

test("participant names reject blanks, controls and normalized duplicates", () => {
  const state = C.createState();
  for (const name of ["", "  ", "x".repeat(61), "A\nB"]) assert.throws(() => C.addEntry(state,name,"x"));
  C.addEntry(state, "Alice", "x");
  assert.throws(() => C.addEntry(state," ALICE ","y"));
  assert.throws(() => C.addEntry(state,"Ａｌｉｃｅ","z"));
});

test("CSV quotes names and neutralizes spreadsheet formulas", () => {
  const state = C.createState();
  C.addEntry(state, '=HYPERLINK("example")', "formula");
  C.addEntry(state, 'Smith, "Jo"', "quote");
  const csv = C.leaderboardCsv(state);
  assert.ok(csv.includes('Smith, ""Jo""'));
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.endsWith("\r\n"));
});
