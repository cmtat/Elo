#!/usr/bin/env python3
# Minimal Elo model wrapper (same interface as previous zip).
import argparse, math, pandas as pd, numpy as np, os, yaml
from datetime import datetime

def win_prob_from_elo_diff(d): return 1/(1+10**(-d/400))
def mov_mult(m, d, scale=2.2): import math; return math.log(abs(m)+1)* (scale/((abs(d)*0.001)+scale))

def load_cfg(): 
    return {"k_base":20,"hfa_points":1.5,"elo_points_per_point":25,"season_regress":0.2,"mov_dampen":True,"mov_scale":2.2,"seed_rating":1500,"neutral_site_hfa":0}

def read_games(p):
    df = pd.read_csv(p, parse_dates=['date'])
    return df.sort_values('date')

def preseason_regress(ratings, cfg, season):
    for t in ratings:
        ratings[t] = (1-cfg["season_regress"])*ratings[t] + cfg["season_regress"]*cfg["seed_rating"]
    return ratings

def run(games):
    cfg = load_cfg()
    ratings = {}
    changelog=[]
    cur_season=None
    for _,r in games.iterrows():
        s=int(r.season)
        if cur_season!=s:
            # regress
            ratings={t:preseason_regress({t:ratings[t]},cfg,s)[t] for t in ratings}
            cur_season=s
        for t in [r.home_team, r.away_team]:
            ratings.setdefault(t, cfg["seed_rating"])
        hfa = (cfg["neutral_site_hfa"] if int(r.neutral_site)==1 else cfg["hfa_points"]) * cfg["elo_points_per_point"]
        d = (ratings[r.home_team]+hfa) - ratings[r.away_team]
        p = win_prob_from_elo_diff(d)
        home_win = 1 if int(r.home_score)>int(r.away_score) else 0
        K = cfg["k_base"]
        mult = mov_mult(abs(int(r.home_score)-int(r.away_score)), d, cfg["mov_scale"]) if cfg["mov_dampen"] else 1.0
        delta = K*mult*(home_win-p)
        ratings[r.home_team]+=delta; ratings[r.away_team]-=delta
    return ratings, cfg

def predict(ratings, cfg, upcoming):
    rows=[]
    for _,r in upcoming.iterrows():
        hfa = (cfg["neutral_site_hfa"] if int(r.neutral_site)==1 else cfg["hfa_points"]) * cfg["elo_points_per_point"]
        d = (ratings.get(r.home_team, cfg["seed_rating"])+hfa) - ratings.get(r.away_team, cfg["seed_rating"])
        p = win_prob_from_elo_diff(d)
        rows.append({"date":r.date.date().isoformat(),"season":int(r.season),"week":int(r.week),
                     "home_team":r.home_team,"away_team":r.away_team,"neutral_site":int(r.neutral_site),
                     "home_win_prob":p,"home_fair_spread_pts": d/cfg["elo_points_per_point"]})
    return pd.DataFrame(rows)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--games", required=True)
    ap.add_argument("--predict", required=False)
    ap.add_argument("--out", default="outputs")
    args=ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    games = read_games(args.games)
    ratings, cfg = run(games)
    pd.DataFrame([{"team":t,"rating":r,"games_played":None,"season":None} for t,r in ratings.items()]).sort_values("rating", ascending=False).to_csv(f"{args.out}/current_ratings.csv", index=False)
    if args.predict:
        upcoming = pd.read_csv(args.predict, parse_dates=['date'])
        predict(ratings, cfg, upcoming).to_csv(f"{args.out}/predictions.csv", index=False)

if __name__ == "__main__":
    main()
