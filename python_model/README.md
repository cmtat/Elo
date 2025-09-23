# Python Elo Model CLI

This directory contains the Python implementation of the NFL Elo / power rating model.

## Installation

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

The `nfl_data_py` dependency can take several minutes to build on first install (it pins `pandas<2.0`). Subsequent runs are fast.

## Usage

```
python elo_model.py [options]
```

Key options:

- `--games` – Path to a historical games CSV. If omitted, provide seasons so the script can download data via `nfl_data_py`.
- `--seasons` – Comma-separated list or range (`2010-2024`) of seasons to pull automatically.
- `--predict` – Path to upcoming schedule CSV. If omitted and `--seasons` is set, the script identifies the next unplayed week from the schedule feed.
- `--market` – Optional market odds CSV (spread + moneyline). If absents, the script will reuse sportsbook lines delivered with nflverse schedules when available.
- `--target-season`, `--target-week` – Override which week to project when auto-fetching.
- `--k-factor`, `--home-field`, `--regression`, `--spread-factor`, `--base-rating` – Model tuning parameters (defaults match the web app).
- `--config` – Path to a JSON file with parameter overrides.
- `--console` – Print a quick summary table after writing CSVs.

Example:

```bash
python elo_model.py --seasons 2018-2024 --target-season 2024 --target-week 3 --out outputs --console
```

## Outputs

- `outputs/ratings.csv` – Latest team ratings ranked by Elo.
- `outputs/game_history.csv` – Per-game record including pre/post ratings and win probability deltas.
- `outputs/predictions.csv` – Upcoming projections with fair spreads/moneylines and edges compared to the market when available.

## Input expectations

Games CSV must include `season`, `week`, `home_team`, `away_team`, `home_score`, `away_score`. Optional columns (`date`, `neutral_site`, `game_id`) are used when present. Upcoming and market CSVs follow the same schema as described in the project root README.
