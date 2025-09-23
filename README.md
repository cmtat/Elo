# NFL Elo Website (Free GitHub Pages)

This repo publishes a free website with your NFL Elo ratings and weekly projections.

## How it works
- **Static site** in `/site` (HTML + JS).
- **GitHub Actions** runs `elo_model.py`, writes JSON to `/data`, then publishes both `/site` and `/data` to **GitHub Pages**.
- You only need a free GitHub account.

## Setup
1. Create a new GitHub repo and upload this folder.
2. In the repo, go to **Settings → Pages → Build and deployment**. Set **Source: GitHub Actions**.
3. Commit. The included workflow will publish to `https://<your-user>.github.io/<repo>/` after it runs.
4. Update your CSVs in `/data`: `games.csv` and `upcoming_week.csv`. On each push or on the weekly schedule, the site updates.

## Local testing
Open `site/index.html` in a browser. It will read placeholder JSON until your first build.
