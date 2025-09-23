async function loadJSON(path){const r=await fetch(path,{cache:'no-store'});if(!r.ok) throw new Error('Fetch '+path);return r.json();}
function moneylineFromProb(p){if(p>0.5){return Math.round(-100*p/(1-p));} else {return Math.round(100*(1-p)/p);}}

async function render(){
  try{
    const ratings = await loadJSON('../data/current_ratings.json');
    const preds = await loadJSON('../data/predictions.json');

    // Ratings table
    const rdiv=document.getElementById('ratings');
    rdiv.innerHTML = tableFrom(ratings, ['team','rating','games_played','season'], {
      headers:{team:'Team',rating:'Rating',games_played:'G',season:'Season'},
      format:{rating:v=>v.toFixed(1)}
    });

    // Predictions, filtered by week input
    const weekInput=document.getElementById('weekInput');
    const pddiv=document.getElementById('predictions');
    function drawPreds(){
      const wk=parseInt(weekInput.value||0,10);
      const rows = preds.filter(x=>x.week===wk).map(x=>{
        const ml = moneylineFromProb(x.home_win_prob);
        return {...x, home_win_pct:(x.home_win_prob*100).toFixed(1)+'%', fair_ml: (ml>0?('+'+ml):ml)};
      });
      pddiv.innerHTML = tableFrom(rows, ['date','home_team','away_team','home_win_pct','fair_ml','home_fair_spread_pts'], {
        headers:{date:'Date',home_team:'Home',away_team:'Away',home_win_pct:'Home Win %',fair_ml:'Fair ML (Home)',home_fair_spread_pts:'Fair Spread (pts)'},
        format:{home_fair_spread_pts:v=>v.toFixed(1)}
      });
    }
    document.getElementById('loadBtn').onclick = drawPreds;
    drawPreds();
  }catch(err){
    document.getElementById('ratings').textContent='Error loading data. Publish via GitHub Actions.';
    console.error(err);
  }
}
function tableFrom(data, cols, opts={}){
  const headers=opts.headers||{}; const format=opts.format||{};
  const th = cols.map(c=>`<th>${headers[c]||c}</th>`).join('');
  const tr = data.map(row=>'<tr>'+cols.map(c=>`<td>${(format[c]?format[c](row[c]):row[c])??''}</td>`).join('')+'</tr>').join('');
  return `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}
render();
