
const state = {
  games: null,
  upcoming: null,
  market: null,
  autoMeta: null,
  ratings: null,
  predictions: null,
  predictionMap: new Map(),
  sportsbookData: [],
  consensusMap: new Map(),
  evInputs: {},
  customBets: [],
  apiKey: '',
  apiLoading: false,
  apiStatus: null,
  activeTab: 'elo',
};

const DEFAULT_CONFIG = {
  baseRating: 1500,
  kFactor: 20,
  regression: 0.25,
  homeFieldAdv: 55,
  spreadFactor: 25,
};

const HEADER_TOOLTIPS = {
  ratings: {
    rank: 'Model Elo rank (1 = highest rating).',
    team: 'Team abbreviation.',
    rating: 'Current Elo rating after processing all completed games.',
    games: 'Number of games played in the dataset for this team.',
    last: 'Date of the most recent game contributing to the rating.',
  },
  predictions: {
    home: 'Home team abbreviation.',
    away: 'Away team abbreviation.',
    prob: 'Model probability that the home team wins.',
    spread: 'Model fair spread (negative favours the home team).',
    fairml: 'Fair moneyline derived from the model win probability.',
    marketspread: 'Sportsbook market spread for the home team.',
    spreadedge: 'Market spread minus model spread (positive = model likes the home side).',
    ml: 'Sportsbook moneyline price for the home team.',
    mledge: 'Difference between model win probability and implied market win probability.',
  },
};

const getHeaderTooltip = (section, key) => (HEADER_TOOLTIPS[section] && HEADER_TOOLTIPS[section][key]) || '';

const TEAM_CODE_CANON = {
  ARI: 'ARI',
  CRD: 'ARI',
  AZ: 'ARI',
  ATL: 'ATL',
  BAL: 'BAL',
  RAV: 'BAL',
  BUF: 'BUF',
  CAR: 'CAR',
  CHI: 'CHI',
  CIN: 'CIN',
  CLE: 'CLE',
  CLV: 'CLE',
  DAL: 'DAL',
  DEN: 'DEN',
  DET: 'DET',
  GB: 'GB',
  GNB: 'GB',
  HOU: 'HOU',
  IND: 'IND',
  JAX: 'JAX',
  JAC: 'JAX',
  KC: 'KC',
  KAN: 'KC',
  LV: 'LV',
  LVR: 'LV',
  OAK: 'LV',
  LAC: 'LAC',
  SD: 'LAC',
  LA: 'LA',
  LAR: 'LA',
  STL: 'LA',
  MIA: 'MIA',
  MIN: 'MIN',
  NE: 'NE',
  NWE: 'NE',
  NO: 'NO',
  NOR: 'NO',
  NYG: 'NYG',
  NYJ: 'NYJ',
  PHI: 'PHI',
  PIT: 'PIT',
  SF: 'SF',
  SFO: 'SF',
  SEA: 'SEA',
  TB: 'TB',
  TAM: 'TB',
  TEN: 'TEN',
  WAS: 'WAS',
  WFT: 'WAS',
};

const canonicalTeamCode = (code) => {
  if (!code) return null;
  const upper = String(code).trim().toUpperCase();
  return TEAM_CODE_CANON[upper] || upper;
};

const TEAM_NAME_MAP = {
  'Arizona Cardinals': 'ARI',
  'Atlanta Falcons': 'ATL',
  'Baltimore Ravens': 'BAL',
  'Buffalo Bills': 'BUF',
  'Carolina Panthers': 'CAR',
  'Chicago Bears': 'CHI',
  'Cincinnati Bengals': 'CIN',
  'Cleveland Browns': 'CLE',
  'Dallas Cowboys': 'DAL',
  'Denver Broncos': 'DEN',
  'Detroit Lions': 'DET',
  'Green Bay Packers': 'GB',
  'Houston Texans': 'HOU',
  'Indianapolis Colts': 'IND',
  'Jacksonville Jaguars': 'JAX',
  'Kansas City Chiefs': 'KC',
  'Las Vegas Raiders': 'LV',
  'Los Angeles Chargers': 'LAC',
  'Los Angeles Rams': 'LA',
  'Miami Dolphins': 'MIA',
  'Minnesota Vikings': 'MIN',
  'New England Patriots': 'NE',
  'New Orleans Saints': 'NO',
  'New York Giants': 'NYG',
  'New York Jets': 'NYJ',
  'Philadelphia Eagles': 'PHI',
  'Pittsburgh Steelers': 'PIT',
  'San Francisco 49ers': 'SF',
  'Seattle Seahawks': 'SEA',
  'Tampa Bay Buccaneers': 'TB',
  'Tennessee Titans': 'TEN',
  'Washington Commanders': 'WAS',
};

const normalizeTeamName = (name) => {
  if (!name) return null;
  const trimmed = String(name).trim();
  const mapped = TEAM_NAME_MAP[trimmed] || trimmed.toUpperCase();
  return canonicalTeamCode(mapped);
};

const HABITATRING_PROXY_URL = 'https://r.jina.ai/http://www.habitatring.com/games.csv';

const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const toBool = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const val = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'y'].includes(val);
};

const parseSeasonList = (raw) => {
  if (!raw) return [];
  const seasons = new Set();
  raw.split(',').forEach((chunk) => {
    const part = chunk.trim();
    if (!part) return;
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-', 2);
      const start = Number(startStr);
      const end = Number(endStr);
      if (Number.isFinite(start) && Number.isFinite(end)) {
        const [lo, hi] = start <= end ? [start, end] : [end, start];
        for (let year = lo; year <= hi; year += 1) seasons.add(year);
      }
    } else {
      const single = Number(part);
      if (Number.isFinite(single)) seasons.add(single);
    }
  });
  return Array.from(seasons).sort((a, b) => a - b);
};

const stripProxyEnvelope = (text) => {
  const marker = '\nMarkdown Content:\n';
  const idx = text.indexOf(marker);
  if (idx === -1) return text.trim();
  return text.slice(idx + marker.length).trim();
};

const extractPublishedTime = (text) => {
  const match = text.match(/Published Time:\s*(.*)/);
  return match ? match[1].trim() : null;
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

const normalizeDate = (series) => {
  if (!series) return null;
  const date = new Date(series);
  return Number.isNaN(date.getTime()) ? null : date;
};

const normalizeGames = (rows) => {
  if (!rows || !rows.length) return [];

  const games = [];
  for (const row of rows) {
    const season = toNumber(firstExisting(row, ['season', 'schedule_season', 'game_season']));
    const week = toNumber(firstExisting(row, ['week', 'schedule_week', 'game_week']));
    const homeTeam = firstExisting(row, ['home_team', 'team_home', 'team_home_abbr']);
    const awayTeam = firstExisting(row, ['away_team', 'team_away', 'team_away_abbr']);
    const homeScore = toNumber(firstExisting(row, ['home_score', 'score_home', 'team_home_score', 'home_score_total']));
    const awayScore = toNumber(firstExisting(row, ['away_score', 'score_away', 'team_away_score', 'away_score_total']));
    const neutralRaw = firstExisting(row, ['neutral_site', 'neutral', 'schedule_neutral_site', 'stadium_neutral']);
    const dateRaw = firstExisting(row, ['date', 'game_date', 'schedule_date', 'gameday']);
    const gameId = firstExisting(row, ['game_id', 'schedule_id', 'gameday_id']);

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

    const date = dateRaw ? normalizeDate(dateRaw) : null;
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
    const season = toNumber(firstExisting(row, ['season', 'schedule_season', 'game_season']));
    const week = toNumber(firstExisting(row, ['week', 'schedule_week', 'game_week']));
    const homeTeam = firstExisting(row, ['home_team', 'team_home', 'team_home_abbr']);
    const awayTeam = firstExisting(row, ['away_team', 'team_away', 'team_away_abbr']);
    if (season === null || week === null || !homeTeam || !awayTeam) continue;
    const dateRaw = firstExisting(row, ['date', 'game_date', 'schedule_date', 'gameday']);
    const gameId = firstExisting(row, ['game_id', 'schedule_id', 'gameday_id']);
    upcoming.push({
      season,
      week,
      date: dateRaw ? normalizeDate(dateRaw) : null,
      homeTeam: String(homeTeam).trim(),
      awayTeam: String(awayTeam).trim(),
      neutral: toBool(firstExisting(row, ['neutral_site', 'neutral', 'schedule_neutral_site'])),
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
    const season = toNumber(firstExisting(row, ['season', 'schedule_season']));
    const week = toNumber(firstExisting(row, ['week', 'schedule_week']));
    const homeTeam = firstExisting(row, ['home_team', 'team_home', 'team_home_abbr']);
    const awayTeam = firstExisting(row, ['away_team', 'team_away', 'team_away_abbr']);
    if (season === null || week === null || !homeTeam || !awayTeam) continue;
    market.push({
      season,
      week,
      homeTeam: String(homeTeam).trim(),
      awayTeam: String(awayTeam).trim(),
      marketSpread: toNumber(firstExisting(row, ['market_spread', 'spread_line', 'home_spread', 'spread'])),
      marketTotal: toNumber(firstExisting(row, ['market_total', 'total_line', 'over_under'])),
      homeMoneyline: toNumber(firstExisting(row, ['home_moneyline', 'moneyline_home', 'home_ml'])),
      awayMoneyline: toNumber(firstExisting(row, ['away_moneyline', 'moneyline_away', 'away_ml'])),
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

const americanOddsToDecimal = (odds) => {
  if (odds === null || odds === undefined || Number.isNaN(Number(odds))) return null;
  const value = Number(odds);
  if (value > 0) {
    return 1 + value / 100;
  }
  if (value < 0) {
    return 1 + 100 / Math.abs(value);
  }
  return null;
};

const expectedValue = (probWin, odds) => {
  const decimal = americanOddsToDecimal(odds);
  if (decimal === null || probWin === null || probWin === undefined) return null;
  const profit = decimal - 1;
  return probWin * profit - (1 - probWin);
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
  const teamState = stateMap.get(team);
  if (season > teamState.lastSeason) {
    teamState.rating = config.baseRating + (teamState.rating - config.baseRating) * (1 - config.regression);
    teamState.lastSeason = season;
  }
  return teamState;
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

    const actual = game.homeScore === game.awayScore ? 0.5 : game.homeScore > game.awayScore ? 1 : 0;
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
      homeTeam: canonicalTeamCode(game.homeTeam),
      awayTeam: canonicalTeamCode(game.awayTeam),
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

const buildPredictionKey = (homeTeam, awayTeam) => `${canonicalTeamCode(homeTeam)}|${canonicalTeamCode(awayTeam)}`;

const buildPredictionMap = (predictions) => {
  const map = new Map();
  predictions.forEach((pred) => {
    map.set(buildPredictionKey(pred.homeTeam, pred.awayTeam), pred);
  });
  return map;
};

const buildConsensusMap = (games) => {
  const map = new Map();
  if (!games || !games.length) return map;

  games.forEach((game) => {
    const homeCode = canonicalTeamCode(normalizeTeamName(game.home_team));
    const awayCode = canonicalTeamCode(normalizeTeamName(game.away_team));
    if (!homeCode || !awayCode) return;
    const key = buildPredictionKey(homeCode, awayCode);

    const consensus = {
      homeTeam: game.home_team,
      awayTeam: game.away_team,
      homeCode,
      awayCode,
      homeProb: null,
      awayProb: null,
      bestHomeMoneyline: null,
      bestAwayMoneyline: null,
      bestHomeMoneylineBook: null,
      bestAwayMoneylineBook: null,
    };

    let homeProbSum = 0;
    let homeProbCount = 0;
    let awayProbSum = 0;
    let awayProbCount = 0;

    (game.bookmakers || []).forEach((book) => {
      const h2h = (book.markets || []).find((m) => m.key === 'h2h');
      if (!h2h) return;
      h2h.outcomes.forEach((outcome) => {
        const teamCode = canonicalTeamCode(normalizeTeamName(outcome.name));
        const price = toNumber(outcome.price);
        if (teamCode === homeCode && price !== null) {
          const implied = oddsToProb(price);
          if (implied !== null) {
            homeProbSum += implied;
            homeProbCount += 1;
          }
          const decimal = americanOddsToDecimal(price);
          if (decimal !== null) {
            const best = consensus.bestHomeMoneyline;
            const bestDecimal = best ? americanOddsToDecimal(best) : null;
            if (bestDecimal === null || decimal > bestDecimal) {
              consensus.bestHomeMoneyline = price;
              consensus.bestHomeMoneylineBook = book.title;
            }
          }
        }
        if (teamCode === awayCode && price !== null) {
          const implied = oddsToProb(price);
          if (implied !== null) {
            awayProbSum += implied;
            awayProbCount += 1;
          }
          const decimal = americanOddsToDecimal(price);
          if (decimal !== null) {
            const best = consensus.bestAwayMoneyline;
            const bestDecimal = best ? americanOddsToDecimal(best) : null;
            if (bestDecimal === null || decimal > bestDecimal) {
              consensus.bestAwayMoneyline = price;
              consensus.bestAwayMoneylineBook = book.title;
            }
          }
        }
      });
    });

    if (homeProbCount > 0) {
      consensus.homeProb = homeProbSum / homeProbCount;
    }
    if (awayProbCount > 0) {
      consensus.awayProb = awayProbSum / awayProbCount;
    }

    map.set(key, consensus);
  });

  return map;
};

const formatNumber = (value, digits = 3) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return Number(value).toFixed(digits);
};

const formatMoneyline = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return value > 0 ? `+${value}` : String(value);
};

const formatPercent = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return `${(value * 100).toFixed(1)}%`;
};

const formatEv = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return `${(value * 100).toFixed(1)}%`;
};

const describeAutoMeta = (meta) => {
  if (!meta) return '';
  const parts = [];
  if (meta.seasons && meta.seasons.length) {
    const first = meta.seasons[0];
    const last = meta.seasons[meta.seasons.length - 1];
    const seasonText = meta.seasons.length > 2 ? `${first}-${last}` : meta.seasons.join(', ');
    parts.push(`seasons ${seasonText}`);
  }
  if (meta.completedGames) {
    parts.push(`${meta.completedGames} completed games`);
  }
  if (meta.lastUpdated) {
    parts.push(`updated ${meta.lastUpdated}`);
  }
  return parts.length ? `Data source: habitatring.com (${parts.join(', ')}).` : '';
};

const renderRatingsTable = (ratings, meta) => {
  if (!ratings || !ratings.length) {
    return '<p class="hint">Run the model to view team ratings.</p>';
  }
  const rows = ratings
    .map((row, index) => {
      const lastGame = row.lastGameDate ? new Date(row.lastGameDate) : null;
      const lastGameDisplay = lastGame ? lastGame.toISOString().slice(0, 10) : '-';
      const lastGameValue = lastGame ? lastGame.getTime() : '';
      return `
        <tr>
          <td data-sort-value="${index + 1}">${index + 1}</td>
          <td data-sort-value="${row.team}">${row.team}</td>
          <td data-sort-value="${row.rating}">${formatNumber(row.rating, 1)}</td>
          <td data-sort-value="${row.gamesPlayed}">${row.gamesPlayed}</td>
          <td data-sort-value="${lastGameValue}">${lastGameDisplay}</td>
        </tr>
      `;
    })
    .join('');
  const metaNote = describeAutoMeta(meta);
  return `
    <section class="collapsible" data-section="ratings">
      <div class="collapsible-header" role="button" tabindex="0" aria-expanded="true">Team Ratings</div>
      <div class="collapsible-body">
        ${metaNote ? `<p class="status meta">${metaNote}</p>` : ''}
        <table class="data-table" data-sortable="true">
          <thead>
            <tr>
              <th data-sort-key="rank" data-sort-type="number" title="${getHeaderTooltip('ratings','rank')}">#</th>
              <th data-sort-key="team" data-sort-type="text" title="${getHeaderTooltip('ratings','team')}">Team</th>
              <th data-sort-key="rating" data-sort-type="number" title="${getHeaderTooltip('ratings','rating')}">Rating</th>
              <th data-sort-key="games" data-sort-type="number" title="${getHeaderTooltip('ratings','games')}">Games</th>
              <th data-sort-key="last" data-sort-type="number" title="${getHeaderTooltip('ratings','last')}">Last Game</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>
  `;
};

const renderPredictionsTable = (predictions) => {
  if (!predictions || !predictions.length) {
    return '<p class="hint">Load an upcoming schedule (or auto-fetch) to see model projections.</p>';
  }

  const filtered = predictions.filter((row) => {
    const hasSpread = row.marketSpread !== null && row.marketSpread !== undefined;
    const hasSpreadEdge = row.homeSpreadEdge !== null && row.homeSpreadEdge !== undefined;
    const hasMoneyline = row.homeMoneyline !== null && row.homeMoneyline !== undefined;
    const hasMoneylineEdge = row.homeMoneylineEdge !== null && row.homeMoneylineEdge !== undefined;
    return (hasSpread && hasSpreadEdge) || (hasMoneyline && hasMoneylineEdge);
  });

  const rows = filtered
    .map((row) => {
      const fairMl = row.homeFairMoneyline ?? '';
      const marketSpread = row.marketSpread ?? '';
      const spreadEdge = row.homeSpreadEdge ?? '';
      const homeMl = row.homeMoneyline ?? '';
      const mlEdge = row.homeMoneylineEdge ?? '';
      return `
      <tr>
        <td data-sort-value="${row.homeTeam}">${row.homeTeam}</td>
        <td data-sort-value="${row.awayTeam}">${row.awayTeam}</td>
        <td data-sort-value="${row.homeWinProb}">${formatPercent(row.homeWinProb)}</td>
        <td data-sort-value="${row.modelSpread}">${formatNumber(row.modelSpread, 1)}</td>
        <td data-sort-value="${fairMl}">${formatMoneyline(row.homeFairMoneyline)}</td>
        <td data-sort-value="${marketSpread}">${row.marketSpread ?? '-'}</td>
        <td data-sort-value="${spreadEdge}">${row.homeSpreadEdge === null ? '-' : formatNumber(row.homeSpreadEdge, 1)}</td>
        <td data-sort-value="${homeMl}">${row.homeMoneyline === null ? '-' : formatMoneyline(row.homeMoneyline)}</td>
        <td data-sort-value="${mlEdge}">${row.homeMoneylineEdge === null ? '-' : formatPercent(row.homeMoneylineEdge)}</td>
      </tr>
    `;
    })
    .join('');

  const explainer = `<p class="hint explanation">Home Win % converts Elo rating differences into win probability; Model Spread divides that rating edge by the Elo-to-spread factor; Fair ML turns the win probability into a moneyline; Market Spread and Home ML come from your uploads/auto fetch; Spread Edge is market spread minus model spread; ML Edge compares model win probability with the market's implied win probability.</p>`;

  return `
    <section class="collapsible" data-section="predictions">
      <div class="collapsible-header" role="button" tabindex="0" aria-expanded="true">Upcoming Games</div>
      <div class="collapsible-body">
        ${explainer}
        <table class="data-table" data-sortable="true">
          <thead>
            <tr>
              <th data-sort-key="home" data-sort-type="text" title="${getHeaderTooltip('predictions','home')}">Home</th>
              <th data-sort-key="away" data-sort-type="text" title="${getHeaderTooltip('predictions','away')}">Away</th>
              <th data-sort-key="prob" data-sort-type="number" title="${getHeaderTooltip('predictions','prob')}">Home Win %</th>
              <th data-sort-key="spread" data-sort-type="number" title="${getHeaderTooltip('predictions','spread')}">Model Spread</th>
              <th data-sort-key="fairml" data-sort-type="number" title="${getHeaderTooltip('predictions','fairml')}">Fair ML</th>
              <th data-sort-key="marketspread" data-sort-type="number" title="${getHeaderTooltip('predictions','marketspread')}">Market Spread</th>
              <th data-sort-key="spreadedge" data-sort-type="number" title="${getHeaderTooltip('predictions','spreadedge')}">Spread Edge</th>
              <th data-sort-key="ml" data-sort-type="number" title="${getHeaderTooltip('predictions','ml')}">Home ML</th>
              <th data-sort-key="mledge" data-sort-type="number" title="${getHeaderTooltip('predictions','mledge')}">ML Edge</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="9">No upcoming games with market data available.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;
};

const computeConsensusForGame = (gameKey) => state.consensusMap.get(gameKey) || null;

const getEvInput = (gameKey) => state.evInputs[gameKey] || { home: '', away: '' };

const renderEvCalculator = () => {
  const container = document.getElementById('evContent');
  if (!container) return;

  if (!state.predictions || !state.predictions.length) {
    container.innerHTML = '<p class="hint">Run the Elo model first to generate matchup probabilities.</p>';
    return;
  }

  if (!state.sportsbookData.length) {
    container.innerHTML = '<p class="hint">Enter your The Odds API key and load sportsbook odds to unlock EV calculations.</p>';
    return;
  }

  const games = state.predictions;
  const sections = games
    .map((game) => {
      const key = buildPredictionKey(game.homeTeam, game.awayTeam);
      const consensus = computeConsensusForGame(key);
      const inputs = getEvInput(key);
      const homeOdds = inputs.home;
      const awayOdds = inputs.away;

      const modelHomeProb = game.homeWinProb;
      const modelAwayProb = game.awayWinProb;
      const consensusHomeProb = consensus?.homeProb ?? null;
      const consensusAwayProb = consensus?.awayProb ?? null;
      const impliedHome = homeOdds === '' ? null : oddsToProb(Number(homeOdds));
      const impliedAway = awayOdds === '' ? null : oddsToProb(Number(awayOdds));
      const modelEvHome = homeOdds === '' ? null : expectedValue(modelHomeProb, Number(homeOdds));
      const modelEvAway = awayOdds === '' ? null : expectedValue(modelAwayProb, Number(awayOdds));
      const consensusEvHome = homeOdds === '' || consensusHomeProb === null ? null : expectedValue(consensusHomeProb, Number(homeOdds));
      const consensusEvAway = awayOdds === '' || consensusAwayProb === null ? null : expectedValue(consensusAwayProb, Number(awayOdds));

      const analytics = `
        <div class="ev-metrics">
          <p><strong>Model Home Win %:</strong> ${formatPercent(modelHomeProb)}</p>
          <p><strong>Consensus Home Win %:</strong> ${formatPercent(consensusHomeProb)}</p>
          <p><strong>Best Market Home ML:</strong> ${formatMoneyline(consensus?.bestHomeMoneyline ?? null)} ${consensus?.bestHomeMoneylineBook ? `(${consensus.bestHomeMoneylineBook})` : ''}</p>
          <p><strong>Best Market Away ML:</strong> ${formatMoneyline(consensus?.bestAwayMoneyline ?? null)} ${consensus?.bestAwayMoneylineBook ? `(${consensus.bestAwayMoneylineBook})` : ''}</p>
        </div>
      `;

      const inputsHtml = `
        <div class="ev-inputs">
          <label> Your Home ML
            <input type="number" step="1" data-ev-input="home" data-game="${key}" value="${homeOdds === '' ? '' : homeOdds}" placeholder="-110" />
          </label>
          <p class="ev-results">Model EV: ${formatEv(modelEvHome)} | Consensus EV: ${formatEv(consensusEvHome)}</p>
          <label> Your Away ML
            <input type="number" step="1" data-ev-input="away" data-game="${key}" value="${awayOdds === '' ? '' : awayOdds}" placeholder="+120" />
          </label>
          <p class="ev-results">Model EV: ${formatEv(modelEvAway)} | Consensus EV: ${formatEv(consensusEvAway)}</p>
        </div>
      `;

      const dateLabel = game.date ? new Date(game.date).toISOString().slice(0, 10) : '';

      return `
        <article class="ev-game">
          <header>
            <h3>${game.awayTeam} @ ${game.homeTeam}${dateLabel ? ` · ${dateLabel}` : ''}</h3>
          </header>
          <div class="ev-body">
            ${analytics}
            ${inputsHtml}
          </div>
        </article>
      `;
    })
    .join('');

  container.innerHTML = sections || '<p class="hint">No games with model projections available.</p>';
  attachEvInputHandlers();
};

const renderCustomSection = () => {
  const select = document.getElementById('customGameSelect');
  if (select) {
    const previous = select.value;
    const options = (state.predictions || []).map((game) => {
      const key = buildPredictionKey(game.homeTeam, game.awayTeam);
      const label = `${game.awayTeam} @ ${game.homeTeam}`;
      return `<option value="${key}">${label}</option>`;
    }).join('');
    select.innerHTML = options || '<option value="">Run the model to populate games</option>';
    if (previous && state.predictionMap.has(previous)) {
      select.value = previous;
    }
  }

  const resultsContainer = document.getElementById('customResults');
  if (!resultsContainer) return;

  if (!state.customBets.length) {
    resultsContainer.innerHTML = '<p class="hint">Add custom wagers to compare against the model and market.</p>';
    return;
  }

  const rows = state.customBets
    .map((bet, index) => {
      const prediction = state.predictionMap.get(bet.gameKey);
      if (!prediction) return '';
      const consensus = computeConsensusForGame(bet.gameKey);
      const isHome = bet.betType === 'home_ml';
      const gameLabel = `${prediction.awayTeam} @ ${prediction.homeTeam}`;
      const betLabel = isHome ? `${prediction.homeTeam} ML` : `${prediction.awayTeam} ML`;
      const modelProb = isHome ? prediction.homeWinProb : prediction.awayWinProb;
      const consensusProb = consensus ? (isHome ? consensus.homeProb : consensus.awayProb) : null;
      const bestMarket = consensus ? (isHome ? consensus.bestHomeMoneyline : consensus.bestAwayMoneyline) : null;
      const implied = oddsToProb(bet.odds);
      const modelEdge = implied === null || modelProb === null ? null : modelProb - implied;
      const consensusEdge = implied === null || consensusProb === null ? null : consensusProb - implied;
      const modelEv = implied === null || modelProb === null ? null : expectedValue(modelProb, bet.odds);
      const consensusEv = implied === null || consensusProb === null ? null : expectedValue(consensusProb, bet.odds);
      return `
      <tr>
        <td>${betLabel} (${gameLabel})</td>
        <td>${formatMoneyline(bet.odds)}</td>
        <td>${formatPercent(modelProb)}</td>
        <td>${formatPercent(modelEdge)}</td>
        <td>${formatEv(modelEv)}</td>
        <td>${formatPercent(consensusProb)}</td>
        <td>${formatPercent(consensusEdge)}</td>
        <td>${formatEv(consensusEv)}</td>
        <td>${formatMoneyline(bestMarket)}</td>
        <td><button type="button" data-remove-bet="${index}">Remove</button></td>
      </tr>
    `;
    })
    .join('');

  resultsContainer.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Bet</th>
          <th>Your Odds</th>
          <th>Model Win %</th>
          <th>Model Edge</th>
          <th>Model EV</th>
          <th>Market Win %</th>
          <th>Market Edge</th>
          <th>Market EV</th>
          <th>Best Market Odds</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  document.querySelectorAll('[data-remove-bet]').forEach((button) => {
    button.addEventListener('click', () => {
      const idx = Number(button.getAttribute('data-remove-bet'));
      state.customBets.splice(idx, 1);
      renderCustomSection();
    });
  });
};

const renderEloSection = () => {
  const output = document.getElementById('eloOutputs');
  if (!output) return;
  const ratingsHtml = renderRatingsTable(state.ratings || [], state.autoMeta);
  const predictionsHtml = renderPredictionsTable(state.predictions || []);
  output.innerHTML = `${ratingsHtml}${predictionsHtml}`;
  initInteractiveSections(output);
};

const attachEvInputHandlers = () => {
  document.querySelectorAll('[data-ev-input]').forEach((input) => {
    input.addEventListener('input', (event) => {
      const target = event.target;
      const side = target.getAttribute('data-ev-input');
      const gameKey = target.getAttribute('data-game');
      if (!gameKey || !side) return;
      const value = target.value;
      const parsed = value === '' ? '' : Number(value);
      if (value !== '' && !Number.isFinite(parsed)) {
        return;
      }
      const existing = state.evInputs[gameKey] || { home: '', away: '' };
      existing[side] = value === '' ? '' : parsed;
      state.evInputs[gameKey] = existing;
      renderEvCalculator();
    });
  });
};

const toggleSection = (header, body) => {
  const isExpanded = header.getAttribute('aria-expanded') === 'true';
  const nextState = !isExpanded;
  header.setAttribute('aria-expanded', String(nextState));
  if (nextState) {
    body.removeAttribute('hidden');
  } else {
    body.setAttribute('hidden', '');
  }
};

const initCollapsibles = (root) => {
  const sections = root.querySelectorAll('.collapsible');
  sections.forEach((section) => {
    const header = section.querySelector('.collapsible-header');
    const body = section.querySelector('.collapsible-body');
    if (!header || !body) return;
    header.setAttribute('aria-expanded', header.getAttribute('aria-expanded') ?? 'true');
    body.removeAttribute('hidden');
    const toggle = () => toggleSection(header, body);
    header.addEventListener('click', (event) => {
      event.preventDefault();
      toggle();
    });
    header.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      }
    });
  });
};

const parseSortValue = (cell, type) => {
  const raw = cell.getAttribute('data-sort-value');
  if (raw === null) {
    const text = cell.textContent.trim();
    if (type === 'number') {
      const num = Number(text);
      return Number.isNaN(num) ? Number.NEGATIVE_INFINITY : num;
    }
    return text.toLowerCase();
  }
  if (type === 'number') {
    if (raw === '' || raw === 'null' || raw === 'undefined') {
      return Number.NEGATIVE_INFINITY;
    }
    const num = Number(raw);
    return Number.isNaN(num) ? Number.NEGATIVE_INFINITY : num;
  }
  return String(raw).toLowerCase();
};

const sortTable = (table, columnIndex, type, direction) => {
  const tbody = table.tBodies[0];
  if (!tbody) return;
  const rows = Array.from(tbody.rows);
  rows.sort((rowA, rowB) => {
    const aVal = parseSortValue(rowA.cells[columnIndex], type);
    const bVal = parseSortValue(rowB.cells[columnIndex], type);
    if (aVal === bVal) return 0;
    if (aVal > bVal) return direction === 'asc' ? 1 : -1;
    return direction === 'asc' ? -1 : 1;
  });
  rows.forEach((row) => tbody.appendChild(row));
};

const initSortableTables = (root) => {
  const tables = root.querySelectorAll('table[data-sortable="true"]');
  tables.forEach((table) => {
    const headers = table.querySelectorAll('th[data-sort-key]');
    headers.forEach((th, index) => {
      const type = th.dataset.sortType || 'text';
      th.setAttribute('role', 'button');
      th.setAttribute('tabindex', '0');
      const handleSort = () => {
        const current = th.getAttribute('data-sort-direction');
        const nextDirection = current === 'asc' ? 'desc' : 'asc';
        headers.forEach((other) => {
          if (other !== th) {
            other.removeAttribute('data-sort-direction');
          }
        });
        th.setAttribute('data-sort-direction', nextDirection);
        sortTable(table, index, type, nextDirection);
      };
      th.addEventListener('click', (event) => {
        event.preventDefault();
        handleSort();
      });
      th.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleSort();
        }
      });
    });
  });
};

const initInteractiveSections = (root) => {
  initCollapsibles(root);
  initSortableTables(root);
};

const setAutoStatus = (message, variant = 'status') => {
  const el = document.getElementById('autoStatus');
  if (!el) return;
  el.textContent = message;
  el.className = `hint ${variant}`;
};

const handleCustomBetSubmit = (event) => {
  event.preventDefault();
  if (!state.predictions || !state.predictions.length) {
    alert('Run the Elo model first.');
    return;
  }

  const gameSelect = document.getElementById('customGameSelect');
  const betTypeSelect = document.getElementById('customBetType');
  const oddsInput = document.getElementById('customOddsInput');
  if (!gameSelect || !betTypeSelect || !oddsInput) return;

  const gameKey = gameSelect.value;
  const betType = betTypeSelect.value;
  const oddsValue = Number(oddsInput.value);

  if (!gameKey || !state.predictionMap.has(gameKey)) {
    alert('Select a valid game.');
    return;
  }
  if (!Number.isFinite(oddsValue)) {
    alert('Enter numeric American odds (e.g. -110 or +120).');
    return;
  }

  const prediction = state.predictionMap.get(gameKey);
  const consensus = computeConsensusForGame(gameKey);
  if (!prediction) {
    alert('Selected game is not available.');
    return;
  }

  const record = {
    gameKey,
    betType,
    odds: oddsValue,
  };
  state.customBets.push(record);
  renderCustomSection();
  oddsInput.value = '';
};

const fetchOddsFromApi = async () => {
  if (!state.apiKey) {
    state.apiStatus = 'Enter your The Odds API key before fetching.';
    updateApiStatus();
    return;
  }

  state.apiLoading = true;
  state.apiStatus = 'Loading sportsbook odds…';
  updateApiStatus();

  try {
    const url = new URL('https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/');
    url.searchParams.set('apiKey', state.apiKey);
    url.searchParams.set('regions', 'us');
    url.searchParams.set('markets', 'h2h');
    url.searchParams.set('oddsFormat', 'american');
    url.searchParams.set('dateFormat', 'iso');

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }
    const data = await response.json();
    state.sportsbookData = Array.isArray(data) ? data : [];
    state.consensusMap = buildConsensusMap(state.sportsbookData);
    state.apiStatus = `Loaded ${state.sportsbookData.length} games from The Odds API.`;
    renderEvCalculator();
    renderCustomSection();
  } catch (error) {
    console.error(error);
    state.apiStatus = `Failed to load odds: ${error.message}`;
  } finally {
    state.apiLoading = false;
    updateApiStatus();
  }
};

const updateApiStatus = () => {
  const el = document.getElementById('apiStatus');
  if (!el) return;
  el.textContent = state.apiStatus || '';
  el.className = `hint ${state.apiLoading ? 'status' : 'status'}`;
};

const setActiveTab = (tabId) => {
  state.activeTab = tabId;
  document.querySelectorAll('.tab-button').forEach((button) => {
    const isActive = button.getAttribute('data-tab') === tabId;
    button.classList.toggle('active', isActive);
  });
  document.querySelectorAll('.tab-section').forEach((section) => {
    section.classList.toggle('active', section.id === `tab-${tabId}`);
  });
};

const runModel = async () => {
  const outputs = document.getElementById('eloOutputs');
  if (outputs) {
    outputs.innerHTML = '<p class="status">Running Elo calculations…</p>';
  }

  if (!state.games || !state.upcoming) {
    if (outputs) {
      outputs.innerHTML = '<p class="error">Please provide games and upcoming schedule data (upload or auto-fetch).</p>';
    }
    return;
  }

  try {
    const games = normalizeGames(state.games);
    const upcoming = normalizeUpcoming(state.upcoming);
    const market = state.market ? normalizeMarket(state.market) : [];

    if (!games.length) {
      if (outputs) {
        outputs.innerHTML = '<p class="error">No completed games found after filtering (season mismatch?).</p>';
      }
      return;
    }

    const { ratings, teams } = computeElo(games, DEFAULT_CONFIG);
    let predictions = mergeMarket(predictGames(upcoming, teams, DEFAULT_CONFIG), market);

    state.ratings = ratings;
    state.predictions = predictions;
    state.predictionMap = buildPredictionMap(predictions);
    const filteredInputs = {};
    state.predictionMap.forEach((_, key) => {
      if (state.evInputs[key]) {
        filteredInputs[key] = state.evInputs[key];
      }
    });
    state.evInputs = filteredInputs;
    state.customBets = state.customBets.filter((bet) => state.predictionMap.has(bet.gameKey));

    renderEloSection();
    renderEvCalculator();
    renderCustomSection();
  } catch (err) {
    console.error(err);
    if (outputs) {
      outputs.innerHTML = `<p class="error">Error running model: ${err.message}</p>`;
    }
  }
};

const getUploadMessage = (key, data, fileName) => {
  if (Array.isArray(data)) {
    return `Loaded ${data.length} rows (${fileName})`;
  }
  return `Loaded: ${fileName}`;
};

const wireFileInput = (inputId, key, parser = parseCsvFile, transform = (value) => value, options = {}) => {
  const input = document.getElementById(inputId);
  const label = input ? input.closest('.file-input') : null;
  const desc = label ? label.querySelector('.input-desc') : null;
  if (desc && !desc.dataset.defaultText) {
    desc.dataset.defaultText = desc.textContent.trim();
  }

  if (!input) return;

  input.addEventListener('change', async (event) => {
    const [file] = event.target.files;
    if (options.resetAutoMeta !== false) {
      state.autoMeta = null;
      setAutoStatus('Awaiting auto fetch (optional).', 'status');
    }
    if (!file) {
      state[key] = null;
      if (desc && desc.dataset.defaultText) {
        desc.textContent = desc.dataset.defaultText;
      }
      return;
    }
    input.disabled = true;
    try {
      const raw = await parser(file);
      const data = transform(raw);
      state[key] = data;
      input.setAttribute('data-loaded', file.name);
      if (desc) {
        desc.textContent = getUploadMessage(key, data, file.name);
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

const handleAutoFetch = async () => {
  const seasonsInput = document.getElementById('seasonInput');
  const seasons = parseSeasonList(seasonsInput ? seasonsInput.value : '');
  if (!seasons.length) {
    setAutoStatus('Enter one or more seasons to auto-fetch.', 'error');
    return;
  }

  setAutoStatus('Downloading schedule and results…');
  try {
    const response = await fetch(`${HABITATRING_PROXY_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to download games CSV (status ${response.status})`);
    }
    const rawText = await response.text();
    const lastUpdated = extractPublishedTime(rawText);
    const csvText = stripProxyEnvelope(rawText);
    const rows = Papa.parse(csvText, {
      header: true,
      dynamicTyping: false,
      skipEmptyLines: true,
    }).data;

    const seasonSet = new Set(seasons);
    const filtered = rows.filter((row) => seasonSet.has(Number(row.season)) && String(row.game_type || '').toUpperCase() !== 'PRE');

    const completed = filtered.filter((row) => row.home_score !== '' && row.away_score !== '');
    const upcoming = filtered.filter((row) => row.home_score === '' || row.away_score === '');

    state.games = completed;
    state.upcoming = upcoming;
    state.market = [];
    state.autoMeta = {
      seasons,
      lastUpdated,
      completedGames: completed.length,
      upcomingGames: upcoming.length,
    };

    setAutoStatus(`Auto data ready (${completed.length} completed, ${upcoming.length} upcoming). Click Run Model.`, 'status');
    renderEloSection();
    renderEvCalculator();
    renderCustomSection();
  } catch (err) {
    console.error(err);
    state.autoMeta = null;
    setAutoStatus(err.message, 'error');
  }
};

const initTabs = () => {
  document.querySelectorAll('.tab-button').forEach((button) => {
    button.addEventListener('click', () => {
      const tabId = button.getAttribute('data-tab');
      setActiveTab(tabId);
    });
  });
  setActiveTab(state.activeTab);
};

const init = () => {
  initTabs();

  wireFileInput('gamesFile', 'games');
  wireFileInput('upcomingFile', 'upcoming');
  wireFileInput('marketFile', 'market');

  document.getElementById('runBtn')?.addEventListener('click', runModel);
  document.getElementById('autoFetchBtn')?.addEventListener('click', handleAutoFetch);

  const apiKeyInput = document.getElementById('apiKeyInput');
  if (apiKeyInput) {
    apiKeyInput.addEventListener('input', (event) => {
      state.apiKey = event.target.value.trim();
    });
  }
  document.getElementById('loadOddsBtn')?.addEventListener('click', fetchOddsFromApi);

  document.getElementById('customBetForm')?.addEventListener('submit', handleCustomBetSubmit);

  setAutoStatus('Awaiting auto fetch (optional).', 'status');
  updateApiStatus();
};

document.addEventListener('DOMContentLoaded', init);
