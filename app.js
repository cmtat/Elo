const state = {
  games: null,
  upcoming: null,
  market: null,
};

const DEFAULT_CONFIG = {
  baseRating: 1500,
  kFactor: 20,
  regression: 0.25,
  homeFieldAdv: 55,
  spreadFactor: 25,
};

const toNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const toBool = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const val = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "y"].includes(val);
};

const parseCsvFile = (file) =>
  new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      dynamicTyping: false,
      skipEmptyLines: true,
      complete: (result) => resolve(result.data),
      error: (err) => reject(err),
    });
  });

const firstExisting = (row, keys) => {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key) && row[key] !== undefined) {
      return row[key];
    }
  }
  return undefined;
};

const normalizeGames = (rows) => {
  if (!rows || !rows.length) return [];

  const games = [];
  for (const row of rows) {
    const season = toNumber(firstExisting(row, ["season", "schedule_season", "game_season"]));
    const week = toNumber(firstExisting(row, ["week", "schedule_week", "game_week"]));
    const homeTeam = firstExisting(row, ["home_team", "team_home", "team_home_abbr"]);
    const awayTeam = firstExisting(row, ["away_team", "team_away", "team_away_abbr"]);
    const homeScore = toNumber(firstExisting(row, ["home_score", "score_home", "team_home_score", "home_score_total"]));
    const awayScore = toNumber(firstExisting(row, ["away_score", "score_away", "team_away_score", "away_score_total"]));
    const neutralRaw = firstExisting(row, ["neutral_site", "neutral", "schedule_neutral_site", "stadium_neutral"]);
    const dateRaw = firstExisting(row, ["date", "game_date", "schedule_date", "gameday"]);
    const gameId = firstExisting(row, ["game_id", "schedule_id", "gameday_id"]);

    if (
      season === null ||
      week === null ||
      !homeTeam ||
      !awayTeam ||
      homeScore === null ||
      awayScore === null
    ) {
      continue;
    }

    const date = dateRaw ? new Date(dateRaw) : null;
    games.push({
      season,
      week,
      date,
      homeTeam: String(homeTeam).trim(),
      awayTeam: String(awayTeam).trim(),
      homeScore,
      awayScore,
      neutral: toBool(neutralRaw),
      gameId: gameId ? String(gameId) : null,
    });
  }

  games.sort((a, b) => {
    const dateA = a.date ? a.date.getTime() : Number.POSITIVE_INFINITY;
    const dateB = b.date ? b.date.getTime() : Number.POSITIVE_INFINITY;
    if (dateA !== dateB) return dateA - dateB;
    if (a.season !== b.season) return a.season - b.season;
    if (a.week !== b.week) return a.week - b.week;
    if (a.homeTeam !== b.homeTeam) return a.homeTeam.localeCompare(b.homeTeam);
    return a.awayTeam.localeCompare(b.awayTeam);
  });

  return games;
};

const normalizeUpcoming = (rows) => {
  if (!rows || !rows.length) return [];
  const upcoming = [];
  for (const row of rows) {
    const season = toNumber(firstExisting(row, ["season", "schedule_season", "game_season"]));
    const week = toNumber(firstExisting(row, ["week", "schedule_week", "game_week"]));
    const homeTeam = firstExisting(row, ["home_team", "team_home", "team_home_abbr"]);
    const awayTeam = firstExisting(row, ["away_team", "team_away", "team_away_abbr"]);
    if (season === null || week === null || !homeTeam || !awayTeam) continue;
    const dateRaw = firstExisting(row, ["date", "game_date", "schedule_date", "gameday"]);
    const gameId = firstExisting(row, ["game_id", "schedule_id", "gameday_id"]);
    upcoming.push({
      season,
      week,
      date: dateRaw ? new Date(dateRaw) : null,
      homeTeam: String(homeTeam).trim(),
      awayTeam: String(awayTeam).trim(),
      neutral: toBool(firstExisting(row, ["neutral_site", "neutral", "schedule_neutral_site"])),
      gameId: gameId ? String(gameId) : null,
    });
  }
  upcoming.sort((a, b) => {
    const dateA = a.date ? a.date.getTime() : Number.POSITIVE_INFINITY;
    const dateB = b.date ? b.date.getTime() : Number.POSITIVE_INFINITY;
    if (dateA !== dateB) return dateA - dateB;
    if (a.season !== b.season) return a.season - b.season;
    return a.week - b.week;
  });
  return upcoming;
};

const normalizeMarket = (rows) => {
  if (!rows || !rows.length) return [];
  const market = [];
  for (const row of rows) {
    const season = toNumber(firstExisting(row, ["season", "schedule_season"]));
    const week = toNumber(firstExisting(row, ["week", "schedule_week"]));
    const homeTeam = firstExisting(row, ["home_team", "team_home", "team_home_abbr"]);
    const awayTeam = firstExisting(row, ["away_team", "team_away", "team_away_abbr"]);
    if (season === null || week === null || !homeTeam || !awayTeam) continue;
    market.push({
      season,
      week,
      homeTeam: String(homeTeam).trim(),
      awayTeam: String(awayTeam).trim(),
      marketSpread: toNumber(firstExisting(row, ["market_spread", "spread_line", "home_spread", "spread"])),
      marketTotal: toNumber(firstExisting(row, ["market_total", "total_line", "over_under"])),
      homeMoneyline: toNumber(firstExisting(row, ["home_moneyline", "moneyline_home", "home_ml"])),
      awayMoneyline: toNumber(firstExisting(row, ["away_moneyline", "moneyline_away", "away_ml"])),
    });
  }
  return market;
};

const logistic = (diff) => 1 / (1 + 10 ** (-diff / 400));

const movMultiplier = (margin, diff) => {
  const mag = Math.max(Math.abs(margin), 1);
  return Math.pow(mag, 0.7) / (7.5 + 0.006 * Math.abs(diff));
};

const probToMoneyline = (prob) => {
  if (prob <= 0 || prob >= 1 || Number.isNaN(prob)) return null;
  if (prob >= 0.5) {
    return Math.round(-100 * (prob / (1 - prob)));
  }
  return Math.round(100 * ((1 - prob) / prob));
};

const oddsToProb = (odds) => {
  if (odds === null || odds === undefined || Number.isNaN(odds)) return null;
  if (odds < 0) return -odds / (-odds + 100);
  return 100 / (odds + 100);
};

const ensureTeamState = (stateMap, team, season, config) => {
  if (!stateMap.has(team)) {
    stateMap.set(team, {
      rating: config.baseRating,
      lastSeason: season,
      gamesPlayed: 0,
      lastGameDate: null,
    });
  }
  const state = stateMap.get(team);
  if (season > state.lastSeason) {
    state.rating = config.baseRating + (state.rating - config.baseRating) * (1 - config.regression);
    state.lastSeason = season;
  }
  return state;
};

const computeElo = (games, config = DEFAULT_CONFIG) => {
  const teams = new Map();
  const history = [];

  for (const game of games) {
    const homeState = ensureTeamState(teams, game.homeTeam, game.season, config);
    const awayState = ensureTeamState(teams, game.awayTeam, game.season, config);

    const homeRatingPre = homeState.rating;
    const awayRatingPre = awayState.rating;

    const homeField = game.neutral ? 0 : config.homeFieldAdv;
    const diff = homeRatingPre + homeField - awayRatingPre;
    const expected = logistic(diff);

    let actual;
    if (game.homeScore === game.awayScore) {
      actual = 0.5;
    } else {
      actual = game.homeScore > game.awayScore ? 1 : 0;
    }

    const margin = game.homeScore - game.awayScore;
    const multiplier = movMultiplier(margin, diff);
    const delta = config.kFactor * multiplier * (actual - expected);

    homeState.rating += delta;
    awayState.rating -= delta;

    homeState.gamesPlayed += 1;
    awayState.gamesPlayed += 1;

    const date = game.date instanceof Date && !Number.isNaN(game.date) ? game.date : null;
    homeState.lastGameDate = date;
    awayState.lastGameDate = date;

    history.push({
      ...game,
      homeRatingPre,
      awayRatingPre,
      homeRatingPost: homeState.rating,
      awayRatingPost: awayState.rating,
      expectedHome: expected,
      actualHome: actual,
      margin,
    });
  }

  const ratings = Array.from(teams.entries())
    .map(([team, info]) => ({
      team,
      rating: info.rating,
      gamesPlayed: info.gamesPlayed,
      lastGameDate: info.lastGameDate,
    }))
    .sort((a, b) => b.rating - a.rating);

  return { ratings, history, teams };
};

const predictGames = (upcoming, teams, config = DEFAULT_CONFIG) => {
  const predictions = [];
  for (const game of upcoming) {
    const homeState = ensureTeamState(teams, game.homeTeam, game.season, config);
    const awayState = ensureTeamState(teams, game.awayTeam, game.season, config);
    const homeRating = homeState.rating;
    const awayRating = awayState.rating;

    const homeField = game.neutral ? 0 : config.homeFieldAdv;
    const diff = homeRating + homeField - awayRating;
    const homeWinProb = logistic(diff);
    const awayWinProb = 1 - homeWinProb;
    const margin = diff / config.spreadFactor;

    predictions.push({
      gameId: game.gameId || null,
      season: game.season,
      week: game.week,
      date: game.date,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      neutral: game.neutral,
      homeRating,
      awayRating,
      ratingDiff: diff,
      modelMargin: margin,
      modelSpread: -margin,
      homeWinProb,
      awayWinProb,
      homeFairMoneyline: probToMoneyline(homeWinProb),
      awayFairMoneyline: probToMoneyline(awayWinProb),
    });
  }
  return predictions;
};

const mergeMarket = (predictions, market) => {
  if (!predictions.length || !market.length) return predictions;
  const key = (row) => `${row.season}|${row.week}|${row.homeTeam}|${row.awayTeam}`;
  const marketMap = new Map(market.map((row) => [key(row), row]));
  return predictions.map((pred) => {
    const matched = marketMap.get(key(pred));
    if (!matched) return pred;
    const homeProbMarket = oddsToProb(matched.homeMoneyline);
    const awayProbMarket = oddsToProb(matched.awayMoneyline);
    return {
      ...pred,
      marketSpread: matched.marketSpread ?? null,
      marketTotal: matched.marketTotal ?? null,
      homeMoneyline: matched.homeMoneyline ?? null,
      awayMoneyline: matched.awayMoneyline ?? null,
      homeSpreadEdge:
        matched.marketSpread === null || matched.marketSpread === undefined
          ? null
          : matched.marketSpread - pred.modelSpread,
      homeMoneylineImplied: homeProbMarket,
      homeMoneylineEdge: homeProbMarket === null ? null : pred.homeWinProb - homeProbMarket,
      awayMoneylineImplied: awayProbMarket,
      awayMoneylineEdge: awayProbMarket === null ? null : pred.awayWinProb - awayProbMarket,
    };
  });
};

const formatNumber = (value, digits = 3) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return Number(value).toFixed(digits);
};

const formatMoneyline = (value) => {
  if (value === null || value === undefined) return "-";
  return value > 0 ? `+${value}` : String(value);
};

const formatPercent = (value) => {
  if (value === null || value === undefined) return "-";
  return `${(value * 100).toFixed(1)}%`;
};

const renderRatingsTable = (ratings) => {
  const rows = ratings
    .map(
      (row, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${row.team}</td>
          <td>${formatNumber(row.rating, 1)}</td>
          <td>${row.gamesPlayed}</td>
          <td>${row.lastGameDate ? new Date(row.lastGameDate).toISOString().slice(0, 10) : "-"}</td>
        </tr>
      `
    )
    .join("");
  return `
    <section>
      <h2>Team Ratings</h2>
      <table class="data-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Team</th>
            <th>Rating</th>
            <th>Games</th>
            <th>Last Game</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="5">No ratings computed.</td></tr>'}</tbody>
      </table>
    </section>
  `;
};

const renderPredictionsTable = (predictions) => {
  const rows = predictions
    .map((row) => `
      <tr>
        <td>${row.homeTeam}</td>
        <td>${row.awayTeam}</td>
        <td>${formatPercent(row.homeWinProb)}</td>
        <td>${formatNumber(row.modelSpread, 1)}</td>
        <td>${formatMoneyline(row.homeFairMoneyline)}</td>
        <td>${row.marketSpread ?? "-"}</td>
        <td>${row.homeSpreadEdge === null ? "-" : formatNumber(row.homeSpreadEdge, 1)}</td>
        <td>${row.homeMoneyline === null ? "-" : formatMoneyline(row.homeMoneyline)}</td>
        <td>${row.homeMoneylineEdge === null ? "-" : formatPercent(row.homeMoneylineEdge)}</td>
      </tr>
    `)
    .join("");
  return `
    <section>
      <h2>Upcoming Games</h2>
      <table class="data-table">
        <thead>
          <tr>
            <th>Home</th>
            <th>Away</th>
            <th>Home Win %</th>
            <th>Model Spread</th>
            <th>Fair ML</th>
            <th>Market Spread</th>
            <th>Spread Edge</th>
            <th>Home ML</th>
            <th>ML Edge</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="9">No upcoming games provided.</td></tr>'}</tbody>
      </table>
    </section>
  `;
};

const runModel = async () => {
  const outputs = document.getElementById("outputs");
  outputs.innerHTML = "<p class=\"status\">Running Elo calculations…</p>";

  if (!state.games || !state.upcoming) {
    outputs.innerHTML = '<p class="error">Please upload games and upcoming schedule CSVs.</p>';
    return;
  }

  try {
    const games = normalizeGames(state.games);
    const upcoming = normalizeUpcoming(state.upcoming);
    const market = state.market ? normalizeMarket(state.market) : [];

    const { ratings, teams } = computeElo(games, DEFAULT_CONFIG);
    const predictions = mergeMarket(predictGames(upcoming, teams, DEFAULT_CONFIG), market);

    outputs.innerHTML = `
      ${renderRatingsTable(ratings)}
      ${renderPredictionsTable(predictions)}
    `;
  } catch (err) {
    console.error(err);
    outputs.innerHTML = `<p class="error">Error running model: ${err.message}</p>`;
  }
};

const wireFileInput = (inputId, key) => {
  const input = document.getElementById(inputId);
  const label = input.closest(".file-input");
  const desc = label ? label.querySelector(".input-desc") : null;
  if (desc && !desc.dataset.defaultText) {
    desc.dataset.defaultText = desc.textContent.trim();
  }

  input.addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) {
      state[key] = null;
      if (desc && desc.dataset.defaultText) {
        desc.textContent = desc.dataset.defaultText;
      }
      return;
    }
    input.disabled = true;
    try {
      state[key] = await parseCsvFile(file);
      input.setAttribute("data-loaded", file.name);
      if (desc) {
        desc.textContent = `Loaded: ${file.name}`;
      }
    } catch (err) {
      console.error(err);
      alert(`Failed to parse ${file.name}: ${err.message}`);
      state[key] = null;
      if (desc && desc.dataset.defaultText) {
        desc.textContent = desc.dataset.defaultText;
      }
    } finally {
      input.disabled = false;
    }
  });
};

const init = () => {
  wireFileInput("gamesFile", "games");
  wireFileInput("upcomingFile", "upcoming");
  wireFileInput("marketFile", "market");
  document.getElementById("runBtn").addEventListener("click", runModel);
};

document.addEventListener("DOMContentLoaded", init);
