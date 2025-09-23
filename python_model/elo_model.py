import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import pandas as pd


@dataclass
class EloConfig:
    base_rating: float = 1500.0
    k_factor: float = 20.0
    regression: float = 0.25
    home_field_advantage: float = 55.0
    spread_factor: float = 25.0


class EloModel:
    def __init__(self, config: EloConfig) -> None:
        self.config = config
        self._teams: Dict[str, Dict[str, object]] = {}
        self.game_history: List[Dict[str, object]] = []

    def _ensure_team(self, team: str, season: int) -> Dict[str, object]:
        state = self._teams.get(team)
        if state is None:
            state = {
                "rating": self.config.base_rating,
                "last_season": season,
                "games_played": 0,
                "last_game_date": None,
            }
            self._teams[team] = state
            return state

        last_season = state["last_season"]
        if season > int(last_season):
            reg = self.config.regression
            state["rating"] = self.config.base_rating + (state["rating"] - self.config.base_rating) * (1 - reg)
            state["last_season"] = season
        return state

    def _logistic(self, rating_diff: float) -> float:
        return 1.0 / (1.0 + 10 ** (-rating_diff / 400.0))

    def _mov_multiplier(self, margin: float, rating_diff: float) -> float:
        margin = max(abs(margin), 1.0)
        return (margin ** 0.7) / (7.5 + 0.006 * abs(rating_diff))

    def _update_team_tracking(self, team: str, date: pd.Timestamp) -> None:
        state = self._teams[team]
        state["games_played"] = int(state.get("games_played", 0)) + 1
        state["last_game_date"] = date

    def rate_games(self, games: pd.DataFrame) -> None:
        if games.empty:
            return

        ordered_games = games.sort_values(["date", "season", "week", "home_team"]).reset_index(drop=True)

        for _, row in ordered_games.iterrows():
            season = int(row["season"])
            home = row["home_team"]
            away = row["away_team"]
            home_state = self._ensure_team(home, season)
            away_state = self._ensure_team(away, season)

            home_rating_pre = float(home_state["rating"])
            away_rating_pre = float(away_state["rating"])

            home_score = float(row["home_score"])
            away_score = float(row["away_score"])
            neutral = bool(row.get("neutral_site", False))
            date = row.get("date")
            if pd.isna(date):
                date = pd.NaT

            home_field = 0.0 if neutral else self.config.home_field_advantage
            rating_diff = (home_rating_pre + home_field) - away_rating_pre
            expected_home = self._logistic(rating_diff)

            if home_score == away_score:
                actual_home = 0.5
            else:
                actual_home = 1.0 if home_score > away_score else 0.0

            margin = home_score - away_score
            mov_multiplier = self._mov_multiplier(margin, rating_diff)
            delta = self.config.k_factor * mov_multiplier * (actual_home - expected_home)

            home_rating_post = home_rating_pre + delta
            away_rating_post = away_rating_pre - delta

            home_state["rating"] = home_rating_post
            away_state["rating"] = away_rating_post

            if not pd.isna(date):
                self._update_team_tracking(home, date)
                self._update_team_tracking(away, date)
            else:
                self._update_team_tracking(home, pd.NaT)
                self._update_team_tracking(away, pd.NaT)

            self.game_history.append(
                {
                    "game_id": row.get("game_id"),
                    "date": date,
                    "season": season,
                    "week": row.get("week"),
                    "home_team": home,
                    "away_team": away,
                    "home_score": home_score,
                    "away_score": away_score,
                    "neutral_site": neutral,
                    "home_rating_pre": home_rating_pre,
                    "away_rating_pre": away_rating_pre,
                    "home_rating_post": home_rating_post,
                    "away_rating_post": away_rating_post,
                    "rating_diff": rating_diff,
                    "expected_home_win_prob": expected_home,
                    "actual_home_result": actual_home,
                    "margin": margin,
                }
            )

    def current_ratings(self) -> pd.DataFrame:
        if not self._teams:
            return pd.DataFrame(columns=["team", "rating", "games_played", "last_game_date"])
        rows = []
        for team, state in self._teams.items():
            rows.append(
                {
                    "team": team,
                    "rating": float(state["rating"]),
                    "games_played": int(state.get("games_played", 0)),
                    "last_game_date": state.get("last_game_date"),
                }
            )
        ratings = pd.DataFrame(rows)
        if not ratings["last_game_date"].isna().all():
            ratings = ratings.sort_values(by=["rating", "last_game_date"], ascending=[False, True])
        else:
            ratings = ratings.sort_values(by="rating", ascending=False)
        ratings.reset_index(drop=True, inplace=True)
        return ratings

    def predict(self, upcoming: pd.DataFrame) -> pd.DataFrame:
        if upcoming.empty:
            return pd.DataFrame()

        records = []
        for _, row in upcoming.iterrows():
            season = int(row["season"])
            home = row["home_team"]
            away = row["away_team"]
            neutral = bool(row.get("neutral_site", False))
            game_id = row.get("game_id")

            home_state = self._ensure_team(home, season)
            away_state = self._ensure_team(away, season)
            home_rating = float(home_state["rating"])
            away_rating = float(away_state["rating"])

            home_field = 0.0 if neutral else self.config.home_field_advantage
            effective_diff = (home_rating + home_field) - away_rating
            home_win_prob = self._logistic(effective_diff)
            away_win_prob = 1.0 - home_win_prob

            predicted_margin = effective_diff / self.config.spread_factor
            home_fair_spread = -predicted_margin

            records.append(
                {
                    "game_id": game_id,
                    "season": season,
                    "week": row.get("week"),
                    "date": row.get("date"),
                    "home_team": home,
                    "away_team": away,
                    "neutral_site": neutral,
                    "home_rating": home_rating,
                    "away_rating": away_rating,
                    "rating_diff": effective_diff,
                    "model_margin": predicted_margin,
                    "model_home_spread": home_fair_spread,
                    "home_win_prob": home_win_prob,
                    "away_win_prob": away_win_prob,
                    "home_fair_moneyline": prob_to_moneyline(home_win_prob),
                    "away_fair_moneyline": prob_to_moneyline(away_win_prob),
                }
            )
        return pd.DataFrame(records)


def parse_seasons(seasons_arg: Optional[str]) -> List[int]:
    if not seasons_arg:
        return []
    seasons: List[int] = []
    for part in seasons_arg.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            start_str, end_str = part.split("-", 1)
            start, end = int(start_str), int(end_str)
            if start > end:
                start, end = end, start
            seasons.extend(list(range(start, end + 1)))
        else:
            seasons.append(int(part))
    return sorted(set(seasons))


def first_existing(df: pd.DataFrame, candidates: Iterable[str]) -> Optional[str]:
    for col in candidates:
        if col in df.columns:
            return col
    return None


def normalize_date(series: pd.Series) -> pd.Series:
    if series.dtype == "datetime64[ns]":
        return series
    return pd.to_datetime(series, errors="coerce")


def normalize_games(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df

    rename_map = {}

    season_col = first_existing(df, ["season", "schedule_season", "game_season"])
    if season_col and season_col != "season":
        rename_map[season_col] = "season"

    week_col = first_existing(df, ["week", "schedule_week", "game_week"])
    if week_col and week_col != "week":
        rename_map[week_col] = "week"

    home_team_col = first_existing(df, [
        "home_team",
        "team_home",
        "team_home_abbr",
        "team_home_name",
    ])
    if home_team_col and home_team_col != "home_team":
        rename_map[home_team_col] = "home_team"

    away_team_col = first_existing(df, [
        "away_team",
        "team_away",
        "team_away_abbr",
        "team_away_name",
    ])
    if away_team_col and away_team_col != "away_team":
        rename_map[away_team_col] = "away_team"

    home_score_col = first_existing(df, [
        "home_score",
        "score_home",
        "team_home_score",
        "home_score_total",
    ])
    if home_score_col and home_score_col != "home_score":
        rename_map[home_score_col] = "home_score"

    away_score_col = first_existing(df, [
        "away_score",
        "score_away",
        "team_away_score",
        "away_score_total",
    ])
    if away_score_col and away_score_col != "away_score":
        rename_map[away_score_col] = "away_score"

    date_col = first_existing(df, [
        "date",
        "game_date",
        "schedule_date",
        "gameday",
        "game_time",
    ])
    if date_col and date_col != "date":
        rename_map[date_col] = "date"

    neutral_col = first_existing(df, [
        "neutral_site",
        "neutral",
        "schedule_neutral_site",
        "stadium_neutral",
    ])
    if neutral_col and neutral_col != "neutral_site":
        rename_map[neutral_col] = "neutral_site"

    game_id_col = first_existing(df, ["game_id", "schedule_id", "gameday_id"])
    if game_id_col and game_id_col != "game_id":
        rename_map[game_id_col] = "game_id"

    df = df.rename(columns=rename_map)

    required_cols = {"season", "week", "home_team", "away_team", "home_score", "away_score"}
    missing = required_cols - set(df.columns)
    if missing:
        raise ValueError(f"Missing required columns: {sorted(missing)}")

    df = df.copy()
    df["season"] = df["season"].astype(int)
    df["week"] = df["week"].astype(int)
    df["home_score"] = pd.to_numeric(df["home_score"], errors="coerce")
    df["away_score"] = pd.to_numeric(df["away_score"], errors="coerce")
    df["date"] = normalize_date(df.get("date", pd.NaT))
    if "neutral_site" in df.columns:
        df["neutral_site"] = df["neutral_site"].fillna(False).astype(bool)
    else:
        df["neutral_site"] = False
    return df


def normalize_upcoming(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df

    rename_map = {}
    season_col = first_existing(df, ["season", "schedule_season", "game_season"])
    if season_col and season_col != "season":
        rename_map[season_col] = "season"
    week_col = first_existing(df, ["week", "schedule_week", "game_week"])
    if week_col and week_col != "week":
        rename_map[week_col] = "week"
    home_team_col = first_existing(df, ["home_team", "team_home", "team_home_abbr"])
    if home_team_col and home_team_col != "home_team":
        rename_map[home_team_col] = "home_team"
    away_team_col = first_existing(df, ["away_team", "team_away", "team_away_abbr"])
    if away_team_col and away_team_col != "away_team":
        rename_map[away_team_col] = "away_team"
    date_col = first_existing(df, ["date", "game_date", "schedule_date", "gameday"])
    if date_col and date_col != "date":
        rename_map[date_col] = "date"
    neutral_col = first_existing(df, ["neutral_site", "neutral", "schedule_neutral_site"])
    if neutral_col and neutral_col != "neutral_site":
        rename_map[neutral_col] = "neutral_site"
    game_id_col = first_existing(df, ["game_id", "schedule_id", "gameday_id"])
    if game_id_col and game_id_col != "game_id":
        rename_map[game_id_col] = "game_id"

    df = df.rename(columns=rename_map)
    required_cols = {"season", "week", "home_team", "away_team"}
    missing = required_cols - set(df.columns)
    if missing:
        raise ValueError(f"Missing required columns in upcoming schedule: {sorted(missing)}")

    df = df.copy()
    df["season"] = df["season"].astype(int)
    df["week"] = df["week"].astype(int)
    df["date"] = normalize_date(df.get("date", pd.NaT))
    if "neutral_site" in df.columns:
        df["neutral_site"] = df["neutral_site"].fillna(False).astype(bool)
    else:
        df["neutral_site"] = False
    return df


def normalize_market(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df

    rename_map = {}
    season_col = first_existing(df, ["season", "schedule_season"])
    if season_col and season_col != "season":
        rename_map[season_col] = "season"
    week_col = first_existing(df, ["week", "schedule_week"])
    if week_col and week_col != "week":
        rename_map[week_col] = "week"
    home_team_col = first_existing(df, ["home_team", "team_home", "team_home_abbr"])
    if home_team_col and home_team_col != "home_team":
        rename_map[home_team_col] = "home_team"
    away_team_col = first_existing(df, ["away_team", "team_away", "team_away_abbr"])
    if away_team_col and away_team_col != "away_team":
        rename_map[away_team_col] = "away_team"
    spread_col = first_existing(df, ["market_spread", "spread_line", "home_spread", "spread"])
    if spread_col and spread_col != "market_spread":
        rename_map[spread_col] = "market_spread"
    total_col = first_existing(df, ["market_total", "total_line", "over_under"])
    if total_col and total_col != "market_total":
        rename_map[total_col] = "market_total"
    home_ml_col = first_existing(df, ["home_moneyline", "home_ml", "ml_home"])
    if home_ml_col and home_ml_col != "home_moneyline":
        rename_map[home_ml_col] = "home_moneyline"
    away_ml_col = first_existing(df, ["away_moneyline", "away_ml", "ml_away"])
    if away_ml_col and away_ml_col != "away_moneyline":
        rename_map[away_ml_col] = "away_moneyline"

    df = df.rename(columns=rename_map)
    required_cols = {"season", "week", "home_team", "away_team"}
    missing = required_cols - set(df.columns)
    if missing:
        raise ValueError(f"Missing required columns in market data: {sorted(missing)}")

    df = df.copy()
    df["season"] = df["season"].astype(int)
    df["week"] = df["week"].astype(int)
    for col in ["market_spread", "market_total", "home_moneyline", "away_moneyline"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


def american_odds_to_prob(odds: Optional[float]) -> Optional[float]:
    if odds is None or pd.isna(odds) or odds == 0:
        return None
    odds = float(odds)
    if odds < 0:
        return (-odds) / ((-odds) + 100.0)
    return 100.0 / (odds + 100.0)


def prob_to_moneyline(prob: float) -> Optional[int]:
    if prob <= 0 or prob >= 1:
        return None
    if prob >= 0.5:
        line = -100.0 * prob / (1.0 - prob)
    else:
        line = 100.0 * (1.0 - prob) / prob
    return int(round(line))


def merge_market(predictions: pd.DataFrame, market: pd.DataFrame) -> pd.DataFrame:
    if predictions.empty or market.empty:
        return predictions

    merged = predictions.merge(
        market,
        on=["season", "week", "home_team", "away_team"],
        how="left",
        suffixes=("", "_market"),
    )

    if "market_spread" in merged.columns:
        merged["home_spread_edge"] = merged["market_spread"] - merged["model_home_spread"]
    if "home_moneyline" in merged.columns:
        merged["home_moneyline_implied"] = merged["home_moneyline"].apply(american_odds_to_prob)
        merged["home_moneyline_edge"] = merged["home_win_prob"] - merged["home_moneyline_implied"]
    if "away_moneyline" in merged.columns:
        merged["away_moneyline_implied"] = merged["away_moneyline"].apply(american_odds_to_prob)
        merged["away_moneyline_edge"] = merged["away_win_prob"] - merged["away_moneyline_implied"]
    return merged


def write_outputs(output_dir: Path, ratings: pd.DataFrame, history: pd.DataFrame, predictions: pd.DataFrame) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    ratings.to_csv(output_dir / "ratings.csv", index=False)
    if not history.empty:
        history.to_csv(output_dir / "game_history.csv", index=False)
    if not predictions.empty:
        predictions.to_csv(output_dir / "predictions.csv", index=False)


def fetch_schedule_data(seasons: Iterable[int]) -> pd.DataFrame:
    try:
        from nfl_data_py import import_schedules
    except ImportError as exc:
        raise SystemExit(
            "nfl_data_py is not installed. Install it or provide local CSVs via --games/--predict options."
        ) from exc

    schedules = import_schedules(list(seasons))
    if schedules.empty:
        return schedules

    # Harmonize column names to align with normalize helpers
    possible_score_cols = {
        "team_home_score": "home_score",
        "team_away_score": "away_score",
        "score_home": "home_score",
        "score_away": "away_score",
    }
    rename_map = {col: alias for col, alias in possible_score_cols.items() if col in schedules.columns}
    if rename_map:
        schedules = schedules.rename(columns=rename_map)
    return schedules


def determine_upcoming_games(schedule_df: pd.DataFrame, season: Optional[int], week: Optional[int]) -> Tuple[pd.DataFrame, Optional[int], Optional[int]]:
    if schedule_df.empty:
        return pd.DataFrame(), season, week

    games = schedule_df.copy()
    if "game_type" in games.columns:
        games = games[games["game_type"].isin(["REG", "SR"])]

    home_scores = games.get("home_score")
    away_scores = games.get("away_score")
    if home_scores is None or away_scores is None:
        completed_mask = pd.Series(False, index=games.index)
    else:
        completed_mask = home_scores.notna() & away_scores.notna()

    completed_games = games[completed_mask]
    upcoming_games = games[~completed_mask]

    resolved_season = season
    resolved_week = week

    if resolved_season is None:
        if not upcoming_games.empty and "season" in upcoming_games.columns:
            resolved_season = int(upcoming_games["season"].astype(int).max())
        elif not completed_games.empty and "season" in completed_games.columns:
            resolved_season = int(completed_games["season"].astype(int).max())

    if resolved_season is not None and "season" in games.columns:
        if "season" in upcoming_games.columns:
            season_upcoming = upcoming_games[upcoming_games["season"].astype(int) == resolved_season]
        else:
            season_upcoming = upcoming_games
        if "season" in completed_games.columns:
            season_completed = completed_games[completed_games["season"].astype(int) == resolved_season]
        else:
            season_completed = completed_games

        if resolved_week is None:
            if not season_upcoming.empty:
                resolved_week = int(season_upcoming["week"].astype(int).min())
            elif not season_completed.empty:
                resolved_week = int(season_completed["week"].astype(int).max() + 1)

        if resolved_week is not None and not season_upcoming.empty:
            week_mask = season_upcoming["week"].astype(int) == resolved_week
            week_games = season_upcoming[week_mask]
            if not week_games.empty:
                week_games = week_games.copy()
                week_games["date"] = normalize_date(week_games.get("date", pd.NaT))
                week_games = week_games.sort_values(["date", "season", "week"], na_position="last")
                return week_games, resolved_season, resolved_week

    if not upcoming_games.empty:
        temp = upcoming_games.copy()
        temp["date"] = normalize_date(temp.get("date", pd.NaT))
        temp = temp.sort_values(["date", "season", "week"], na_position="last")
        first = temp.iloc[0]

        season_candidate = first.get("season", resolved_season)
        if pd.isna(season_candidate):
            season_candidate = resolved_season
        inferred_season = int(season_candidate) if season_candidate is not None else resolved_season

        week_candidate = first.get("week", resolved_week)
        if pd.isna(week_candidate):
            week_candidate = resolved_week
        inferred_week = int(week_candidate) if week_candidate is not None else resolved_week

        season_series = temp.get("season")
        week_series = temp.get("week")
        if season_series is not None and week_series is not None:
            mask = (season_series.astype(int) == inferred_season) & (week_series.astype(int) == inferred_week)
            filtered = temp[mask]
        else:
            filtered = temp
        return filtered, inferred_season or resolved_season, inferred_week or resolved_week

    return pd.DataFrame(), resolved_season, resolved_week



def load_games_data(args: argparse.Namespace) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, Optional[int], Optional[int]]:
    seasons = parse_seasons(args.seasons)
    schedule_df = pd.DataFrame()
    if args.games:
        games_df = pd.read_csv(args.games)
        games = normalize_games(games_df.dropna(subset=["home_score", "away_score"]))
    else:
        if not seasons:
            raise SystemExit("Provide --seasons when using nfl_data_py to fetch games.")
        schedule_df = fetch_schedule_data(seasons)
        if schedule_df.empty:
            raise SystemExit("No schedule data returned; check seasons provided.")
        games = normalize_games(schedule_df.dropna(subset=["home_score", "away_score"]))

    if args.predict:
        upcoming_df = pd.read_csv(args.predict)
        upcoming = normalize_upcoming(upcoming_df)
        target_season = args.target_season or upcoming["season"].iloc[0]
        target_week = args.target_week or upcoming["week"].iloc[0]
    else:
        if schedule_df.empty:
            if not seasons:
                raise SystemExit("Cannot derive upcoming schedule without --predict or --seasons.")
            schedule_df = fetch_schedule_data(seasons)
        upcoming, target_season, target_week = determine_upcoming_games(
            normalize_upcoming(schedule_df.copy()), args.target_season, args.target_week
        )

    if args.market:
        market_df = pd.read_csv(args.market)
        market = normalize_market(market_df)
    else:
        market = pd.DataFrame()
        if not schedule_df.empty and {"spread_line", "total_line"}.intersection(schedule_df.columns):
            market_cols = ["season", "week", "home_team", "away_team"]
            if "spread_line" in schedule_df.columns:
                market_cols.append("spread_line")
            if "total_line" in schedule_df.columns:
                market_cols.append("total_line")
            if "moneyline_home" in schedule_df.columns:
                market_cols.append("moneyline_home")
            if "moneyline_away" in schedule_df.columns:
                market_cols.append("moneyline_away")
            market = schedule_df[market_cols].rename(
                columns={
                    "spread_line": "market_spread",
                    "total_line": "market_total",
                    "moneyline_home": "home_moneyline",
                    "moneyline_away": "away_moneyline",
                }
            )
            market = normalize_market(market)

    return games, upcoming, market, target_season, target_week


def summarise_console(ratings: pd.DataFrame, predictions: pd.DataFrame, target_season: Optional[int], target_week: Optional[int]) -> None:
    pd.set_option("display.max_columns", None)
    pd.set_option("display.width", 120)

    print("\nTop Elo Ratings:")
    print(ratings.head(10).to_string(index=False))

    if not predictions.empty:
        title_bits = []
        if target_season is not None:
            title_bits.append(str(target_season))
        if target_week is not None:
            title_bits.append(f"Week {target_week}")
        print("\nUpcoming Games (" + " ".join(title_bits) + "):")
        display_cols = [
            "home_team",
            "away_team",
            "home_win_prob",
            "model_home_spread",
            "home_fair_moneyline",
            "home_spread_edge" if "home_spread_edge" in predictions.columns else None,
            "home_moneyline_edge" if "home_moneyline_edge" in predictions.columns else None,
        ]
        display_cols = [c for c in display_cols if c and c in predictions.columns]
        print(predictions[display_cols].to_string(index=False, float_format=lambda x: f"{x:0.3f}"))


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="NFL Elo rating model CLI")
    parser.add_argument("--games", type=Path, help="Path to historical games CSV (optional when using nfl_data_py)")
    parser.add_argument("--predict", type=Path, help="Path to upcoming schedule CSV")
    parser.add_argument("--market", type=Path, help="Path to market odds CSV")
    parser.add_argument("--seasons", type=str, help="Comma/range list of seasons to pull via nfl_data_py (e.g. 2010-2023)")
    parser.add_argument("--target-season", dest="target_season", type=int, help="Season for upcoming week when auto-fetching")
    parser.add_argument("--target-week", dest="target_week", type=int, help="Week for upcoming games when auto-fetching")
    parser.add_argument("--k-factor", dest="k_factor", type=float, default=20.0, help="Elo K factor")
    parser.add_argument("--home-field", dest="home_field", type=float, default=55.0, help="Home field advantage in Elo points")
    parser.add_argument("--regression", type=float, default=0.25, help="Off-season regression toward mean (0-1)")
    parser.add_argument("--spread-factor", dest="spread_factor", type=float, default=25.0, help="Rating points per spread point")
    parser.add_argument("--base-rating", dest="base_rating", type=float, default=1500.0, help="Base Elo rating")
    parser.add_argument("--out", type=Path, default=Path("outputs"), help="Output directory for CSVs")
    parser.add_argument("--console", action="store_true", help="Print summaries to console")
    parser.add_argument("--config", type=Path, help="Optional JSON config with overrides")
    return parser


def load_config(path: Optional[Path]) -> Dict[str, object]:
    if not path:
        return {}
    if not path.exists():
        raise FileNotFoundError(f"Config file not found: {path}")
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def main() -> None:
    parser = build_arg_parser()
    args = parser.parse_args()

    config_overrides = load_config(args.config)
    config = EloConfig(
        base_rating=float(config_overrides.get("base_rating", args.base_rating)),
        k_factor=float(config_overrides.get("k_factor", args.k_factor)),
        regression=float(config_overrides.get("regression", args.regression)),
        home_field_advantage=float(config_overrides.get("home_field", args.home_field)),
        spread_factor=float(config_overrides.get("spread_factor", args.spread_factor)),
    )

    games, upcoming, market, target_season, target_week = load_games_data(args)

    model = EloModel(config)
    if not games.empty:
        model.rate_games(games)

    ratings = model.current_ratings()

    predictions = pd.DataFrame()
    if not upcoming.empty:
        predictions = model.predict(upcoming)
        if not market.empty:
            predictions = merge_market(predictions, market)

    history_df = pd.DataFrame(model.game_history)

    write_outputs(args.out, ratings, history_df, predictions)

    if args.console:
        summarise_console(ratings, predictions, target_season, target_week)


if __name__ == "__main__":
    main()
