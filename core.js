(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SuperBowlSheet = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const QUESTIONS = [
  {
    "id": "coin-toss",
    "label": "What will be the result of the opening coin toss?",
    "options": [
      {
        "value": "heads",
        "label": "Heads"
      },
      {
        "value": "tails",
        "label": "Tails"
      }
    ]
  },
  {
    "id": "first-quarter",
    "label": "Which team will lead at the end of the first quarter?",
    "options": [
      {
        "value": "eagles",
        "label": "Eagles"
      },
      {
        "value": "chiefs",
        "label": "Chiefs"
      },
      {
        "value": "tie",
        "label": "Tie"
      }
    ]
  },
  {
    "id": "first-score",
    "label": "Which team will reach five points or more first?",
    "options": [
      {
        "value": "eagles",
        "label": "Eagles"
      },
      {
        "value": "chiefs",
        "label": "Chiefs"
      }
    ]
  },
  {
    "id": "mahomes-touchdowns",
    "label": "Patrick Mahomes: over or under 1.5 passing touchdowns?",
    "options": [
      {
        "value": "over",
        "label": "Over"
      },
      {
        "value": "under",
        "label": "Under"
      }
    ]
  },
  {
    "id": "hurts-passing",
    "label": "Jalen Hurts: over or under 243.5 passing yards?",
    "options": [
      {
        "value": "over",
        "label": "Over"
      },
      {
        "value": "under",
        "label": "Under"
      }
    ]
  },
  {
    "id": "total-touchdowns",
    "label": "Total touchdowns scored: over or under 6.5?",
    "options": [
      {
        "value": "over",
        "label": "Over"
      },
      {
        "value": "under",
        "label": "Under"
      }
    ]
  },
  {
    "id": "highest-scoring-half",
    "label": "Which half will have more points?",
    "options": [
      {
        "value": "first",
        "label": "First half"
      },
      {
        "value": "second",
        "label": "Second half"
      },
      {
        "value": "tie",
        "label": "Tie"
      }
    ]
  },
  {
    "id": "super-bowl-mvp",
    "label": "Will a quarterback win Super Bowl MVP?",
    "options": [
      {
        "value": "yes",
        "label": "Yes"
      },
      {
        "value": "no",
        "label": "No"
      }
    ]
  },
  {
    "id": "last-points",
    "label": "Which team will score the last points?",
    "options": [
      {
        "value": "eagles",
        "label": "Eagles"
      },
      {
        "value": "chiefs",
        "label": "Chiefs"
      }
    ]
  },
  {
    "id": "eagles-every-quarter",
    "label": "Will the Eagles score in every quarter?",
    "options": [
      {
        "value": "yes",
        "label": "Yes"
      },
      {
        "value": "no",
        "label": "No"
      }
    ]
  },
  {
    "id": "total-points",
    "label": "Will the total points be odd or even?",
    "options": [
      {
        "value": "odd",
        "label": "Odd"
      },
      {
        "value": "even",
        "label": "Even"
      }
    ]
  },
  {
    "id": "score-firstquarter",
    "label": "Will both teams score in the first quarter?",
    "options": [
      {
        "value": "yes",
        "label": "Yes"
      },
      {
        "value": "no",
        "label": "No"
      }
    ]
  },
  {
    "id": "travis-kelce",
    "label": "Will Travis Kelce score a touchdown?",
    "options": [
      {
        "value": "yes",
        "label": "Yes"
      },
      {
        "value": "no",
        "label": "No"
      }
    ]
  },
  {
    "id": "first-field-goal",
    "label": "Which team will make the first field goal?",
    "options": [
      {
        "value": "eagles",
        "label": "Eagles"
      },
      {
        "value": "chiefs",
        "label": "Chiefs"
      }
    ]
  },
  {
    "id": "score-first",
    "label": "Which team will score first?",
    "options": [
      {
        "value": "eagles",
        "label": "Eagles"
      },
      {
        "value": "chiefs",
        "label": "Chiefs"
      }
    ]
  },
  {
    "id": "aj-brown",
    "label": "A.J. Brown: over or under 72.5 receiving yards?",
    "options": [
      {
        "value": "over",
        "label": "Over"
      },
      {
        "value": "under",
        "label": "Under"
      }
    ]
  },
  {
    "id": "patrick-mahomes",
    "label": "Patrick Mahomes: over or under 290.5 passing yards?",
    "options": [
      {
        "value": "over",
        "label": "Over"
      },
      {
        "value": "under",
        "label": "Under"
      }
    ]
  },
  {
    "id": "both-teams-25",
    "label": "Will both teams score at least 25 points?",
    "options": [
      {
        "value": "yes",
        "label": "Yes"
      },
      {
        "value": "no",
        "label": "No"
      }
    ]
  },
  {
    "id": "both-teams-score-3rdQ",
    "label": "Will both teams score in the third quarter?",
    "options": [
      {
        "value": "yes",
        "label": "Yes"
      },
      {
        "value": "no",
        "label": "No"
      }
    ]
  },
  {
    "id": "miles-sanders",
    "label": "Will Miles Sanders score a touchdown?",
    "options": [
      {
        "value": "yes",
        "label": "Yes"
      },
      {
        "value": "no",
        "label": "No"
      }
    ]
  },
  {
    "id": "devonta-smith",
    "label": "DeVonta Smith: over or under 64.5 receiving yards?",
    "options": [
      {
        "value": "over",
        "label": "Over"
      },
      {
        "value": "under",
        "label": "Under"
      }
    ]
  },
  {
    "id": "jerrick-mckinnon",
    "label": "Jerick McKinnon: over or under 22.5 receiving yards?",
    "options": [
      {
        "value": "over",
        "label": "Over"
      },
      {
        "value": "under",
        "label": "Under"
      }
    ]
  },
  {
    "id": "isiah-pacheco",
    "label": "Isiah Pacheco: over or under 48.5 rushing yards?",
    "options": [
      {
        "value": "over",
        "label": "Over"
      },
      {
        "value": "under",
        "label": "Under"
      }
    ]
  },
  {
    "id": "any-player-2+",
    "label": "Will any player score two or more touchdowns? Passing touchdowns do not count.",
    "options": [
      {
        "value": "yes",
        "label": "Yes"
      },
      {
        "value": "no",
        "label": "No"
      }
    ]
  },
  {
    "id": "coach-gatorade-water",
    "label": "Will the winning coach have Gatorade or water poured on him?",
    "options": [
      {
        "value": "gatorade",
        "label": "Gatorade"
      },
      {
        "value": "water",
        "label": "Water"
      }
    ]
  }
];
  const VERSION = 1;
  const EVENT = "super-bowl-lvii";
  const MAX_ENTRIES = 500;
  const byId = new Map(QUESTIONS.map(q => [q.id, q]));
  function createState() { return { version: VERSION, event: EVENT, entries: [], results: {} }; }
  function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
  function normalizeName(value) {
    if (typeof value !== "string") throw new Error("Enter a participant name.");
    const name = value.trim();
    if (!name || name.length > 60 || /[\u0000-\u001f\u007f]/.test(name))
      throw new Error("Names must contain 1–60 characters without control characters.");
    return name;
  }
  function nameKey(value) { return normalizeName(value).normalize("NFKC").toLocaleLowerCase("en-US"); }
  function answers(value, results) {
    if (!object(value)) throw new Error("Answers must be an object.");
    const clean = {};
    for (const [id, choice] of Object.entries(value)) {
      const question = byId.get(id);
      if (!question || typeof choice !== "string" ||
          !(choice === "" || (results && choice === "void") || question.options.some(o => o.value === choice)))
        throw new Error("The file contains an unknown question or invalid answer.");
      if (choice) clean[id] = choice;
    }
    return clean;
  }
  function validateState(value) {
    if (!object(value) || value.version !== VERSION || value.event !== EVENT ||
        !Array.isArray(value.entries) || value.entries.length > MAX_ENTRIES)
      throw new Error("Choose a compatible Super Bowl LVII sheet (version 1, up to 500 participants).");
    const ids = new Set(), names = new Set();
    const entries = value.entries.map(entry => {
      if (!object(entry) || typeof entry.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(entry.id) || ids.has(entry.id))
        throw new Error("Participant IDs must be valid and unique.");
      const name = normalizeName(entry.name), key = nameKey(name);
      if (names.has(key)) throw new Error("Participant names must be unique.");
      ids.add(entry.id); names.add(key);
      return { id: entry.id, name, picks: answers(entry.picks, false) };
    });
    return { version: VERSION, event: EVENT, entries, results: answers(value.results, true) };
  }
  function addEntry(state, name, id) {
    name = normalizeName(name);
    if (state.entries.length >= MAX_ENTRIES) throw new Error("This sheet is limited to 500 participants.");
    if (state.entries.some(entry => nameKey(entry.name) === nameKey(name)))
      throw new Error("That participant name is already in use.");
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(id) || state.entries.some(e => e.id === id))
      throw new Error("Could not create a unique participant ID.");
    const entry = { id, name, picks: {} };
    state.entries.push(entry);
    return entry;
  }
  function score(entry, results) {
    let correct = 0, settled = 0, voided = 0, answered = 0;
    for (const question of QUESTIONS) {
      if (entry.picks[question.id]) answered++;
      const result = results[question.id];
      if (result === "void") { voided++; continue; }
      if (!result) continue;
      settled++;
      if (entry.picks[question.id] === result) correct++;
    }
    return { correct, settled, answered, voided, possible: QUESTIONS.length - voided,
      pending: QUESTIONS.length - voided - settled };
  }
  function leaderboard(state) {
    const rows = state.entries.map(entry => ({ id: entry.id, name: entry.name, ...score(entry, state.results) }))
      .sort((a, b) => b.correct - a.correct || a.name.localeCompare(b.name, "en"));
    let previous = null, rank = 0;
    return rows.map((row, index) => {
      if (row.correct !== previous) rank = index + 1;
      previous = row.correct;
      return { ...row, rank };
    });
  }
  function csvCell(value) {
    let text = String(value);
    if (/^[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function leaderboardCsv(state) {
    const rows = [["Rank", "Participant", "Correct", "Settled", "Picks answered", "Eligible questions"]];
    for (const row of leaderboard(state))
      rows.push([row.rank, row.name, row.correct, row.settled, row.answered, row.possible]);
    return rows.map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }
  return { QUESTIONS, VERSION, EVENT, MAX_ENTRIES, createState, validateState, normalizeName,
    nameKey, addEntry, score, leaderboard, leaderboardCsv };
});
