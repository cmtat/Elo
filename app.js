
// Minimal in-browser Elo model with MOV dampening and HFA
const defaultConfig = {
  k_base: 20,
  hfa_points: 1.5,
  elo_points_per_point: 25,
  season_regress: 0.2,
  mov_dampen: true,
  mov_scale: 2.2,
  seed_rating: 1500,
  neutral_site_hfa: 0
};

const teams = ["ARI","ATL","BAL","BUF","CAR","CHI","CIN","CLE","DAL","DEN","DET","GB","HOU","IND","JAX","KC","LV","LAC","LAR","MIA","MIN","NE","NO","NYG","NYJ","PHI","PIT","SEA","SF","TB","TEN","WAS"];

function parseCSV(file) {
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>{
      const text=reader.result;
      try {
        const parsed = Papa.parse(text,{header:true});
        resolve(parsed.data);
      } catch(e){ reject(e); }
    };
    reader.onerror=reject;
    reader.readAsText(file);
  });
}

function winProbFromEloDiff(diff){
  return 1 / (1 + Math.pow(10, -diff/400));
}

function movMultiplier(margin, eloDiff, scale){
  const m = Math.log(Math.abs(margin)+1) * (scale / ((Math.abs(eloDiff)*0.001)+scale));
  return m;
}

function preseasonRegression(ratings, cfg, season){
  for(const t of Object.keys(ratings)){
    ratings[t].rating = (1-cfg.season_regress)*ratings[t].rating + cfg.season_regress*cfg.seed_rating;
    ratings[t].season = season;
    ratings[t].games = 0;
  }
}

function initTeam(ratings, team, cfg, season){
  if(!ratings[team]) ratings[team]={rating:cfg.seed_rating,games:0,season};
}

function toNum(x){ if(x===undefined||x===null||x==='') return 0; return +x; }

function runElo(games, cfg){
  // sort by date
  games = games.map(r=>({...r, date:new Date(r.date)})).sort((a,b)=>a.date-b.date);
  const ratings={};
  const allSeasons = [...new Set(games.map(g=>+g.season))].sort((a,b)=>a-b);
  let curSeason=null;
  const changelog=[];

  for(const row of games){
    const season = +row.season;
    if(curSeason===null || season!==curSeason){
      // make sure all teams seen this season exist
      for(const r of games.filter(g=>+g.season===season)){
        initTeam(ratings, r.home_team, cfg, season);
        initTeam(ratings, r.away_team, cfg, season);
      }
      preseasonRegression(ratings, cfg, season);
      curSeason = season;
    }
    initTeam(ratings, row.home_team, cfg, season);
    initTeam(ratings, row.away_team, cfg, season);

    const hs = +row.home_score, as = +row.away_score;
    const neutral = +row.neutral_site===1;
    const hfa_pts = neutral ? cfg.neutral_site_hfa : cfg.hfa_points;
    const hfa_elo = hfa_pts * cfg.elo_points_per_point;

    const rHome = ratings[row.home_team].rating;
    const rAway = ratings[row.away_team].rating;
    const eloDiff = (rHome + hfa_elo) - rAway;
    const expHome = winProbFromEloDiff(eloDiff);
    const homeWin = hs > as ? 1 : 0;
    const margin = hs - as;

    let mult = 1;
    if(cfg.mov_dampen){
      mult = movMultiplier(Math.abs(margin), eloDiff, cfg.mov_scale);
    }
    const K = cfg.k_base;
    const delta = K * mult * (homeWin - expHome);
    ratings[row.home_team].rating = rHome + delta;
    ratings[row.away_team].rating = rAway - delta;
    ratings[row.home_team].games += 1;
    ratings[row.away_team].games += 1;

    changelog.push({
      date: row.date.toISOString().slice(0,10),
      season, week:+row.week,
      home_team: row.home_team, away_team: row.away_team,
      pre_home: rHome, pre_away: rAway,
      hfa_elo, elo_diff_pre: eloDiff, exp_home: expHome,
      home_delta: delta, away_delta: -delta,
      post_home: ratings[row.home_team].rating, post_away: ratings[row.away_team].rating
    });
  }

  const ratingsArr = Object.entries(ratings).map(([team,v])=>({team, rating:v.rating, games:v.games, season:v.season}))
    .sort((a,b)=>b.rating-a.rating);
  return {ratings, ratingsArr, changelog};
}

function predictGames(ratings, games, cfg){
  const out=[];
  for(const row of games){
    const neutral = +row.neutral_site===1;
    const hfa_pts = neutral ? cfg.neutral_site_hfa : cfg.hfa_points;
    const hfa_elo = hfa_pts * cfg.elo_points_per_point;

    const rHome = ratings[row.home_team]?.rating ?? cfg.seed_rating;
    const rAway = ratings[row.away_team]?.rating ?? cfg.seed_rating;
    const eloDiff = (rHome + hfa_elo) - rAway;
    const pHome = winProbFromEloDiff(eloDiff);
    const fairSpread = eloDiff / cfg.elo_points_per_point;
    const fairML = pHome>0.5 ? Math.round(-100 * pHome/(1-pHome)) : Math.round(100*(1-pHome)/pHome);
    out.push({
      date: row.date, season:+row.season, week:+row.week,
      home_team: row.home_team, away_team: row.away_team, neutral_site:+row.neutral_site,
      home_win_prob: +(pHome*100).toFixed(1),
      home_fair_spread: +fairSpread.toFixed(2),
      home_fair_ml: fairML
    });
  }
  return out;
}

function americanToProb(ml){
  const v = +ml;
  if(isNaN(v)) return null;
  if(v<0) return (-v)/((-v)+100);
  return 100/(v+100);
}

function computeEdges(preds, market){
  if(!market) return [];
  const key = r => `${r.date}|${r.home_team}|${r.away_team}`;
  const predMap = new Map(preds.map(r=>[key(r),r]));
  const out=[];
  for(const m of market){
    const k = key(m);
    const p = predMap.get(k);
    if(!p) continue;
    if(m.market_type==="moneyline" && m.moneyline_home){
      const imp = americanToProb(m.moneyline_home);
      const model = p.home_win_prob/100;
      out.push({
        date:m.date, home_team:m.home_team, away_team:m.away_team, book:m.book,
        moneyline_home:m.moneyline_home, model_home_win_prob:p.home_win_prob,
        edge_pct:+((model - imp)*100).toFixed(1)
      });
    } else if(m.market_type==="spread" && m.spread_home){
      const edgePts = p.home_fair_spread - (+m.spread_home);
      out.push({
        date:m.date, home_team:m.home_team, away_team:m.away_team, book:m.book,
        spread_home:m.spread_home, model_home_fair_spread:p.home_fair_spread,
        edge_points:+edgePts.toFixed(2)
      });
    }
  }
  return out;
}

function renderTable(el, rows){
  if(!rows || rows.length===0){ el.innerHTML="<p class='muted'>No data</p>"; return; }
  const cols = Object.keys(rows[0]);
  const thead = `<thead><tr>${cols.map(c=>`<th>${c}</th>`).join("")}</tr></thead>`;
  const tbody = "<tbody>"+rows.map(r=>`<tr>${cols.map(c=>`<td>${r[c]}</td>`).join("")}</tr>`).join("")+"</tbody>";
  el.innerHTML = `<table>${thead}${tbody}</table>`;
}

async function main(){
  const gamesInput = document.getElementById("gamesFile");
  const upcomingInput = document.getElementById("upcomingFile");
  const marketInput = document.getElementById("marketFile");
  const runBtn = document.getElementById("runBtn");
  const ratingsDiv = document.getElementById("ratingsTable");
  const predsDiv = document.getElementById("predsTable");
  const edgesDiv = document.getElementById("edgesTable");
  const configBox = document.getElementById("configBox");
  const loadDefault = document.getElementById("loadDefault");
  const downloadCfg = document.getElementById("downloadConfig");
  const uploadCfg = document.getElementById("configUpload");

  loadDefault.onclick = ()=>{ configBox.value = JSON.stringify(defaultConfig, null, 2); };
  downloadCfg.onclick = ()=>{
    const blob = new Blob([configBox.value], {type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "config.json";
    a.click();
  };
  uploadCfg.onchange = async (e)=>{
    const f = e.target.files[0];
    if(!f) return;
    const text = await f.text();
    configBox.value = text;
  };

  loadDefault.click();

  runBtn.onclick = async ()=>{
    if(!gamesInput.files[0] || !upcomingInput.files[0]){
      alert("Please upload games.csv and upcoming_week.csv");
      return;
    }
    const cfg = JSON.parse(configBox.value);
    const games = await parseCSV(gamesInput.files[0]);
    const upcoming = await parseCSV(upcomingInput.files[0]);
    const market = marketInput.files[0] ? await parseCSV(marketInput.files[0]) : null;

    const {ratingsArr, ratings} = runElo(games, cfg);
    renderTable(ratingsDiv, ratingsArr.map(r=>({team:r.team, rating: r.rating.toFixed(1), games:r.games})));

    const preds = predictGames(ratings, upcoming, cfg);
    renderTable(predsDiv, preds);

    const edges = computeEdges(preds, market);
    renderTable(edgesDiv, edges);
  };
}

document.addEventListener("DOMContentLoaded", main);
