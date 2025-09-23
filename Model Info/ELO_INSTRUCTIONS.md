# NFL Elo Model + Odds Comparison Guide

## 1) What Elo predicts
Elo produces a team rating on a continuous scale. The difference between two teams’ ratings maps to:
- Win probability for the home team
- A fair point spread
- A fair moneyline

You will update ratings game by game, then use the latest ratings to price upcoming games.

---

## 2) Core parameters
- `seed_rating = 1500` (league average)
- `k_base = 20` (update speed)
- `hfa_points = 1.5` (home field advantage in scoreboard points)
- `elo_points_per_point = 25` (25 Elo points per 1 scoreboard point is a good starting map)
- `season_regress = 0.20` (offseason regression toward 1500)
- `mov_scale = 2.2` (margin of victory dampening strength)

---

## 3) From Elo to probabilities and prices
Let `elo_diff = (Elo_home + HFA_elo) - Elo_away`, where `HFA_elo = hfa_points * elo_points_per_point`.

- **Home win probability**
  ```
  p_home = 1 / (1 + 10^(-elo_diff / 400))
  ```

- **Fair spread (home team, in points)**
  ```
  fair_spread_home = elo_diff / elo_points_per_point
  ```

- **Fair moneyline (American odds for home team)**
  ```
  if p_home > 0.5:
      fair_ml_home = -100 * p_home / (1 - p_home)
  else:
      fair_ml_home =  100 * (1 - p_home) / p_home
  ```

---

## 4) Updating Elo after each game
For a played game with final scores `home_score`, `away_score`:
- Determine outcome:
  ```
  home_win = 1 if home_score > away_score else 0
  margin   = home_score - away_score
  ```

- Expected result given pregame ratings:
  ```
  exp_home = 1 / (1 + 10^(-elo_diff / 400))
  ```

- Margin of victory multiplier (dampens blowouts):
  ```
  mov_mult = ln(|margin| + 1) * (mov_scale / ((|elo_diff| * 0.001) + mov_scale))
  ```

- Rating updates:
  ```
  delta = k_base * mov_mult * (home_win - exp_home)
  Elo_home_new = Elo_home_old + delta
  Elo_away_new = Elo_away_old - delta
  ```

### Offseason regression
Before the first game of a new season:
```
Elo_team = (1 - season_regress) * Elo_team + season_regress * seed_rating
```

---

## 5) Minimal data you need per game
`date, season, week, home_team, away_team, home_score, away_score, neutral_site`

---

## 6) Comparing your Elo to odds you enter

### Convert sportsbook American odds to implied probability
```
def implied_prob_from_american(ml):
    ml = float(ml)
    if ml < 0:
        return (-ml) / ((-ml) + 100)
    else:
        return 100 / (ml + 100)
```

### Expected value of a moneyline bet
... (keep the full math details from guide)
