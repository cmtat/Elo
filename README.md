# NFL Elo Ratings Toolkit

End-to-end tooling for building an NFL Elo / power rating model and reviewing betting edges.

- **Python CLI** (in `python_model/`) fetches data via `nfl_data_py`, maintains Elo ratings, and exports CSVs for ratings, historical game states, and upcoming projections.
- **Static Web App** (`index.html`, `app.js`, `style.css`) runs the same Elo logic entirely in the browser. Upload CSV exports to view live ratings and market edges.

## Project Layout

```
.
├── data/                 # Example CSV inputs
├── python_model/         # Python CLI implementation
├── index.html            # Browser interface entry point
├── app.js                # Client-side Elo + rendering logic
└── style.css             # Styling for the static site
```

## Getting Started

### 1. Python CLI

```bash
cd python_model
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python elo_model.py --help
```

**Common workflows**

- Use nflverse data directly (fetch 2010-2024 results and build Week 5 predictions):

  ```bash
  python elo_model.py \
    --seasons 2010-2024 \
    --target-season 2024 \
    --target-week 5 \
    --out outputs \
    --console
  ```

- Run with your own exports:

  ```bash
  python elo_model.py \
    --games ../data/games.csv \
    --predict ../data/upcoming_week.csv \
    --market ../data/market_lines.csv \
    --out outputs \
    --console
  ```

The CLI writes three CSVs into the `--out` directory:

- `ratings.csv` – latest team ratings after processing all games.
- `game_history.csv` – per-game rating deltas and pre/post snapshots.
- `predictions.csv` – upcoming projections plus market edges (when provided).

All model parameters (base rating, K-factor, home field, regression, spread conversion) can be overridden via CLI flags or a JSON config passed to `--config`.

### 2. Static Website

Open `index.html` in your browser (or host the repo with GitHub Pages). The UI is split into three tabs:

- **Elo Model Ratings** – upload games/schedules or auto-fetch nflverse data, then run the Elo engine to view ratings and upcoming edges.
- **EV Calculator** – enter your [The Odds API](https://the-odds-api.com) key, pull current US sportsbook prices, and plug in your own odds to see expected value versus the market consensus and the model.
- **Custom Bet Comparison** – pick a game, enter the odds you can place, and instantly compare against the Elo win probability and aggregated market lines.

Everything runs client-side—no backend required.

## Input Data Contracts

Both the CLI and web app expect the following columns (extra columns are ignored):

- **Games CSV** – `season`, `week`, `home_team`, `away_team`, `home_score`, `away_score`, optional `date`, `neutral_site`, `game_id`.
- **Upcoming CSV** – `season`, `week`, `home_team`, `away_team`, optional `date`, `neutral_site`, `game_id`.
- **Market CSV** – `season`, `week`, `home_team`, `away_team`, optional `market_spread`, `market_total`, `home_moneyline`, `away_moneyline`.

Different nflverse exports use slightly different column names; the loaders normalise common variations automatically.

## Next Steps

- Tune Elo parameters or margin-of-victory weighting as you validate against historical performance.
- Extend the UI with filtering/highlighting for large betting edges.
- Add pytest/unit tests around the Python model for long-term maintainability.
