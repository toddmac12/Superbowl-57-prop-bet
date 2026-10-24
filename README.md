# Super Bowl LVII Prediction Score Sheet

A browser-based score sheet for the original 25 Eagles/Chiefs Super Bowl LVII questions. No database, account, payment service, or live sports feed is required.

## Run

Open `index.html` in a modern browser. For a consistent browser storage origin, you can serve the folder with Python:

```powershell
git clone https://github.com/toddmac12/Superbowl-57-prop-bet.git
cd Superbowl-57-prop-bet
py -m http.server 5002
```

Open http://localhost:5002. If PHP is already installed, `php -S localhost:5002` also works; the original `/super-bowl.php` URL displays the same page.

## Use

1. Add a participant and choose their predictions. Every answer starts blank.
2. Switch participants to keep separate entries; rename or remove them as needed.
3. Use **Result key** to enter actual outcomes manually. Quarter-leader and highest-scoring-half questions include ties. Mark a question void if it cannot be settled under your group's rules.
4. Each matching settled answer earns one point. Pending and void results do not count toward the displayed scoring denominator. Equal scores share a competition rank (1, 1, 3).
5. Export JSON to back up the entire sheet, or CSV for scores. Import validates the file before asking to replace the current sheet. Print includes the current participant's predictions (or the result key) and the leaderboard.

These remain historical Super Bowl LVII questions, not a live/current-season game. Official answers are not prefilled; the host enters results and resolves ambiguous outcomes.

## Saving and portability

Changes are saved only in this browser's local storage. Devices and browsers do not synchronize automatically. Clearing browser data or changing the serving address/port can make a different sheet appear. Export JSON regularly to keep a portable copy. Import replaces the whole sheet after confirmation; it does not merge entries.

If storage is blocked or full, the page displays a warning and keeps changes in the current tab. Export before closing. Invalid saved data is preserved rather than silently overwritten until an explicit import/reset. Names and imported data are rendered as text. Backups are limited to 1 MB and 500 uniquely named participants. All app assets are local; there are no analytics, remote fonts, or third-party runtime requests.

## Development checks

Node.js 22+ is used only for development tests, not to run the score sheet.

```powershell
npm ci --ignore-scripts
npm run check
npm test
```

Tests cover all 25 question definitions, normalized values and tie choices, blank defaults, scoring, tied ranks, backup validation, CSV formula handling, real DOM controls, saved entries/reload, participant isolation, safe name rendering, cancellation, storage failures, and import replacement. GitHub Actions also syntax-checks the PHP compatibility entrypoint.
