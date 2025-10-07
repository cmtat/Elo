
const CONFIG = {
  seedRating: 1500,
  kFactor: 20,
  regression: 0.20,
  homeFieldPoints: 1.5,
  spreadFactor: 25,
  movScale: 2.2,
};

const escapeHtml = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char] || char);
};

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
  evSelectedGame: null,
  evWeekFilter: null,
  evBookSelection: 'manual',
  bestEvWeekFilter: null,
  eloWeekFilter: null,
  eloGameFilter: null,
  customBets: [],
  clvHistory: [],
  clvLatest: new Map(),
  apiKey: '',
  apiLoading: false,
  apiStatus: null,
  activeTab: 'input',
};

const HEADER_TOOLTIPS = {
  ratings: {
    rank: 'Model Elo rank (1 = highest rating).',
    team: 'Team abbreviation.',
    rating: 'Current Elo rating after processing all completed games.',
    games: 'Number of games played by this team in the sample.',
    last: 'Date of the most recent game contributing to the rating.',
  },
  predictions: {
    home: 'Home team abbreviation.',
    away: 'Away team abbreviation.',
    prob: 'Model probability that the home team wins outright.',
    spread: 'Model fair spread (negative favours the home team).',
    fairml: 'Moneyline price implied by the model win probability.',
    marketspread: 'Sportsbook market spread for the home team (if provided).',
    spreadedge: 'Market spread minus model spread.',
    ml: 'Sportsbook moneyline price for the home team (if provided).',
    mledge: 'Model win probability minus the market implied probability.',
  },
};

const getHeaderTooltip = (section, key) => (HEADER_TOOLTIPS[section] && HEADER_TOOLTIPS[section][key]) || '';

const TEAM_CODE_MAP = {
  ARI: 'ARI', CRD: 'ARI', AZ: 'ARI',
  ATL: 'ATL',
  BAL: 'BAL', RAV: 'BAL',
  BUF: 'BUF',
  CAR: 'CAR',
  CHI: 'CHI',
  CIN: 'CIN',
  CLE: 'CLE', CLV: 'CLE',
  DAL: 'DAL',
  DEN: 'DEN',
  DET: 'DET',
  GB: 'GB', GNB: 'GB',
  HOU: 'HOU',
  IND: 'IND',
  JAX: 'JAX', JAC: 'JAX',
  KC: 'KC', KAN: 'KC',
  LV: 'LV', LVR: 'LV', OAK: 'LV',
  LAC: 'LAC', SD: 'LAC',
  LA: 'LA', LAR: 'LA', STL: 'LA',
  MIA: 'MIA',
  MIN: 'MIN',
  NE: 'NE', NWE: 'NE',
  NO: 'NO', NOR: 'NO',
  NYG: 'NYG',
  NYJ: 'NYJ',
  PHI: 'PHI',
  PIT: 'PIT',
  SF: 'SF', SFO: 'SF',
  SEA: 'SEA',
  TB: 'TB', TAM: 'TB',
  TEN: 'TEN',
  WAS: 'WAS', WFT: 'WAS',
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

const canonicalTeamCode = (value) => {
  if (!value) return null;
  const trimmed = String(value).trim();
  const upper = trimmed.toUpperCase();
  return TEAM_CODE_MAP[upper] || TEAM_NAME_MAP[trimmed] || upper;
};

const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const toBool = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const str = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'y'].includes(str);
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
        for (let year = lo; year <= hi; year += 1) {
          seasons.add(year);
        }
      }
    } else {
      const val = Number(part);
      if (Number.isFinite(val)) seasons.add(val);
    }
  });
  return Array.from(seasons).sort((a, b) => a - b);
};

const normalizeDate = (value) => {
  if (!value) return null;
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
};

const parseCsvFile = (file) => new Promise((resolve, reject) => {
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
  rows.forEach((row) => {
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
      return;
    }
    games.push({
      season,
      week,
      date: dateRaw ? normalizeDate(dateRaw) : null,
      homeTeam: canonicalTeamCode(homeTeam),
      awayTeam: canonicalTeamCode(awayTeam),
      homeScore,
      awayScore,
      neutral: toBool(neutralRaw),
      gameId: gameId ? String(gameId) : null,
    });
  });
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
  rows.forEach((row) => {
    const season = toNumber(firstExisting(row, ['season', 'schedule_season', 'game_season']));
    const week = toNumber(firstExisting(row, ['week', 'schedule_week', 'game_week']));
    const homeTeam = firstExisting(row, ['home_team', 'team_home', 'team_home_abbr']);
    const awayTeam = firstExisting(row, ['away_team', 'team_away', 'team_away_abbr']);
    if (season === null || week === null || !homeTeam || !awayTeam) return;
    const dateRaw = firstExisting(row, ['date', 'game_date', 'schedule_date', 'gameday']);
    const gameId = firstExisting(row, ['game_id', 'schedule_id', 'gameday_id']);
    upcoming.push({
      season,
      week,
      date: dateRaw ? normalizeDate(dateRaw) : null,
      homeTeam: canonicalTeamCode(homeTeam),
      awayTeam: canonicalTeamCode(awayTeam),
      neutral: toBool(firstExisting(row, ['neutral_site', 'neutral', 'schedule_neutral_site'])),
      gameId: gameId ? String(gameId) : null,
    });
  });
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
  rows.forEach((row) => {
    const season = toNumber(firstExisting(row, ['season', 'schedule_season']));
    const week = toNumber(firstExisting(row, ['week', 'schedule_week']));
    const homeTeam = firstExisting(row, ['home_team', 'team_home', 'team_home_abbr']);
    const awayTeam = firstExisting(row, ['away_team', 'team_away', 'team_away_abbr']);
    if (season === null || week === null || !homeTeam || !awayTeam) return;
    market.push({
      season,
      week,
      homeTeam: canonicalTeamCode(homeTeam),
      awayTeam: canonicalTeamCode(awayTeam),
      marketSpread: toNumber(firstExisting(row, ['market_spread', 'spread_line', 'home_spread', 'spread'])),
      marketTotal: toNumber(firstExisting(row, ['market_total', 'total_line', 'over_under'])),
      homeMoneyline: toNumber(firstExisting(row, ['home_moneyline', 'moneyline_home', 'home_ml'])),
      awayMoneyline: toNumber(firstExisting(row, ['away_moneyline', 'moneyline_away', 'away_ml'])),
    });
  });
  return market;
};

const logistic = (eloDiff) => 1 / (1 + 10 ** (-eloDiff / 400));

const marginMultiplier = (margin, eloDiff) => {
  const absoluteMargin = Math.abs(margin);
  if (absoluteMargin === 0) return 0;
  return Math.log(absoluteMargin + 1) * (CONFIG.movScale / ((Math.abs(eloDiff) * 0.001) + CONFIG.movScale));
};

const probToMoneyline = (prob) => {
  if (prob <= 0 || prob >= 1 || Number.isNaN(prob)) return null;
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
};

const oddsToProb = (odds) => {
  if (odds === null || odds === undefined || Number.isNaN(odds)) return null;
  if (odds < 0) return (-odds) / ((-odds) + 100);
  return 100 / (odds + 100);
};

const americanToDecimal = (odds) => {
  if (odds === null || odds === undefined || Number.isNaN(odds)) return null;
  if (odds > 0) return 1 + (odds / 100);
  if (odds < 0) return 1 + (100 / Math.abs(odds));
  return null;
};

const expectedValue = (probWin, odds) => {
  const decimal = americanToDecimal(odds);
  if (decimal === null || probWin === null || probWin === undefined) return null;
  const profit = decimal - 1;
  return probWin * profit - (1 - probWin);
};

const ensureClvTracking = () => {
  if (!(state.clvLatest instanceof Map)) {
    state.clvLatest = new Map();
  }
  if (!Array.isArray(state.clvHistory)) {
    state.clvHistory = [];
  }
};

const buildClvKey = (gameKey, market, side) => `${gameKey}|${market}|${side}`;

const recordClvSnapshot = ({
  gameKey,
  market,
  side,
  userOdds,
  userLine,
  consensusOdds,
  consensusLine,
  consensusProb,
  impliedProb,
}) => {
  ensureClvTracking();
  const oddsValid = Number.isFinite(userOdds);
  const consensusOddsValid = Number.isFinite(consensusOdds);
  if (!oddsValid || !consensusOddsValid) return;
  const isPointMarket = market !== 'moneyline';
  if (isPointMarket) {
    if (!Number.isFinite(userLine) || !Number.isFinite(consensusLine)) return;
  }
  if (consensusProb === null || Number.isNaN(consensusProb)) return;
  const key = buildClvKey(gameKey, market, side);
  const snapshot = {
    timestamp: new Date().toISOString(),
    gameKey,
    market,
    side,
    userOdds,
    userLine: Number.isFinite(userLine) ? userLine : null,
    consensusOdds,
    consensusLine: Number.isFinite(consensusLine) ? consensusLine : null,
    consensusProb,
    impliedProb: impliedProb ?? null,
    edgeProb: consensusProb !== null && impliedProb !== null ? consensusProb - impliedProb : null,
    fairOdds: consensusProb === null ? null : probToMoneyline(consensusProb),
    oddsDiff: Number.isFinite(consensusOdds) ? userOdds - consensusOdds : null,
    lineDiff: isPointMarket && Number.isFinite(userLine) && Number.isFinite(consensusLine)
      ? userLine - consensusLine
      : null,
  };
  const last = state.clvLatest.get(key);
  if (
    last
    && last.userOdds === snapshot.userOdds
    && last.userLine === snapshot.userLine
    && last.consensusOdds === snapshot.consensusOdds
    && last.consensusLine === snapshot.consensusLine
  ) {
    return;
  }
  state.clvLatest.set(key, {
    userOdds: snapshot.userOdds,
    userLine: snapshot.userLine,
    consensusOdds: snapshot.consensusOdds,
    consensusLine: snapshot.consensusLine,
  });
  state.clvHistory.push(snapshot);
};

const trackClvForInput = (gameKey, evType, side) => {
  const consensus = state.consensusMap.get(gameKey);
  const inputs = state.evInputs[gameKey];
  if (!consensus || !inputs) return;

  if (evType === 'moneyline') {
    const userOdds = toNumber(inputs.moneyline[side]);
    if (userOdds === null) return;
    const marketNode = getConsensusMoneyline(consensus, side);
    if (!marketNode) return;
    recordClvSnapshot({
      gameKey,
      market: 'moneyline',
      side,
      userOdds,
      userLine: null,
      consensusOdds: marketNode.odds ?? null,
      consensusLine: null,
      consensusProb: marketNode.prob ?? null,
      impliedProb: oddsToProb(userOdds),
    });
    return;
  }

  if (evType === 'spread') {
    const userOdds = toNumber(inputs.spread[side].odds);
    const userLine = toNumber(inputs.spread[side].line);
    if (userOdds === null || userLine === null) return;
    const marketEntry = getSpreadEntry(consensus, userLine, side);
    if (!marketEntry) return;
    recordClvSnapshot({
      gameKey,
      market: 'spread',
      side,
      userOdds,
      userLine,
      consensusOdds: marketEntry.odds ?? null,
      consensusLine: marketEntry.line ?? null,
      consensusProb: marketEntry.prob ?? null,
      impliedProb: oddsToProb(userOdds),
    });
    return;
  }

  if (evType === 'total') {
    const userOdds = toNumber(inputs.total[side].odds);
    const userLine = toNumber(inputs.total[side].line);
    if (userOdds === null || userLine === null) return;
    const marketEntry = getTotalEntry(consensus, userLine, side);
    if (!marketEntry) return;
    recordClvSnapshot({
      gameKey,
      market: 'total',
      side,
      userOdds,
      userLine,
      consensusOdds: marketEntry.odds ?? null,
      consensusLine: marketEntry.line ?? null,
      consensusProb: marketEntry.prob ?? null,
      impliedProb: oddsToProb(userOdds),
    });
  }
};

const ensureTeamState = (teamStates, team, season) => {
  let state = teamStates.get(team);
  if (!state) {
    state = { rating: CONFIG.seedRating, lastSeason: season, gamesPlayed: 0, lastGameDate: null };
    teamStates.set(team, state);
    return state;
  }
  if (season > state.lastSeason) {
    state.rating = (1 - CONFIG.regression) * state.rating + CONFIG.regression * CONFIG.seedRating;
    state.lastSeason = season;
  }
  return state;
};

const computeElo = (games) => {
  const teams = new Map();
  const history = [];
  games.forEach((game) => {
    const homeState = ensureTeamState(teams, game.homeTeam, game.season);
    const awayState = ensureTeamState(teams, game.awayTeam, game.season);
    const homeElo = homeState.rating;
    const awayElo = awayState.rating;
    const homeFieldElo = CONFIG.homeFieldPoints * CONFIG.spreadFactor;
    const eloDiff = (homeElo + (game.neutral ? 0 : homeFieldElo)) - awayElo;
    const expectedHome = logistic(eloDiff);
    const homeWin = game.homeScore > game.awayScore ? 1 : game.homeScore === game.awayScore ? 0.5 : 0;
    const margin = game.homeScore - game.awayScore;
    const movMult = marginMultiplier(margin, eloDiff);
    const delta = CONFIG.kFactor * movMult * (homeWin - expectedHome);
    homeState.rating += delta;
    awayState.rating -= delta;
    homeState.gamesPlayed += 1;
    awayState.gamesPlayed += 1;
    const date = game.date || null;
    homeState.lastGameDate = date;
    awayState.lastGameDate = date;
    history.push({
      ...game,
      homeRatingPre: homeElo,
      awayRatingPre: awayElo,
      homeRatingPost: homeState.rating,
      awayRatingPost: awayState.rating,
      expectedHome,
      actualHome: homeWin,
      margin,
    });
  });
  const ratings = Array.from(teams.entries()).map(([team, info]) => ({
    team,
    rating: info.rating,
    gamesPlayed: info.gamesPlayed,
    lastGameDate: info.lastGameDate,
  })).sort((a, b) => b.rating - a.rating);
  return { ratings, history, teams };
};

const predictGames = (upcoming, teamStates) => {
  const predictions = [];
  upcoming.forEach((game) => {
    const homeState = ensureTeamState(teamStates, game.homeTeam, game.season);
    const awayState = ensureTeamState(teamStates, game.awayTeam, game.season);
    const homeFieldElo = CONFIG.homeFieldPoints * CONFIG.spreadFactor;
    const eloDiff = (homeState.rating + (game.neutral ? 0 : homeFieldElo)) - awayState.rating;
    const homeWinProb = logistic(eloDiff);
    const awayWinProb = 1 - homeWinProb;
    const fairSpreadHome = eloDiff / CONFIG.spreadFactor;
    predictions.push({
      gameId: game.gameId,
      season: game.season,
      week: game.week,
      date: game.date,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      neutral: game.neutral,
      ratingDiff: eloDiff,
      homeWinProb,
      awayWinProb,
      modelMargin: eloDiff / CONFIG.spreadFactor,
      modelSpread: -fairSpreadHome,
      homeFairMoneyline: probToMoneyline(homeWinProb),
      awayFairMoneyline: probToMoneyline(awayWinProb),
    });
  });
  return predictions;
};

const mergeMarket = (predictions, marketRows) => {
  if (!predictions || !predictions.length || !marketRows || !marketRows.length) return predictions;
  const index = new Map();
  marketRows.forEach((row) => {
    const key = `${row.season}|${row.week}|${row.homeTeam}|${row.awayTeam}`;
    index.set(key, row);
  });
  return predictions.map((pred) => {
    const key = `${pred.season}|${pred.week}|${pred.homeTeam}|${pred.awayTeam}`;
    const market = index.get(key);
    if (!market) return pred;
    const homeProbMarket = oddsToProb(market.homeMoneyline);
    const awayProbMarket = oddsToProb(market.awayMoneyline);
    return {
      ...pred,
      marketSpread: market.marketSpread ?? null,
      marketTotal: market.marketTotal ?? null,
      homeMoneyline: market.homeMoneyline ?? null,
      awayMoneyline: market.awayMoneyline ?? null,
      homeMoneylineImplied: homeProbMarket,
      awayMoneylineImplied: awayProbMarket,
      homeMoneylineEdge: homeProbMarket === null ? null : pred.homeWinProb - homeProbMarket,
      awayMoneylineEdge: awayProbMarket === null ? null : pred.awayWinProb - awayProbMarket,
      homeSpreadEdge: market.marketSpread === null || market.marketSpread === undefined ? null : market.marketSpread - pred.modelSpread,
    };
  });
};

const buildPredictionKey = (homeTeam, awayTeam) => `${homeTeam}|${awayTeam}`;

const buildPredictionMap = (predictions) => {
  const map = new Map();
  predictions.forEach((pred) => {
    map.set(buildPredictionKey(pred.homeTeam, pred.awayTeam), pred);
  });
  return map;
};

const buildWeekKey = (season, week) => `${season}|${week}`;

const parseWeekKey = (key) => {
  if (!key || typeof key !== 'string') return null;
  const [seasonStr, weekStr] = key.split('|');
  const season = Number(seasonStr);
  const week = Number(weekStr);
  if (!Number.isFinite(season) || !Number.isFinite(week)) return null;
  return { season, week };
};

const compareWeeksChronological = (a, b) => {
  const timeA = Number.isFinite(a.firstTimestamp) ? a.firstTimestamp : Number.POSITIVE_INFINITY;
  const timeB = Number.isFinite(b.firstTimestamp) ? b.firstTimestamp : Number.POSITIVE_INFINITY;
  if (timeA < timeB) return -1;
  if (timeA > timeB) return 1;
  if (a.season !== b.season) return a.season - b.season;
  return a.week - b.week;
};

const findEarliestWeekKey = (predictions) => {
  let earliest = null;
  let earliestTime = Number.POSITIVE_INFINITY;
  predictions.forEach((prediction) => {
    if (!Number.isFinite(prediction.season) || !Number.isFinite(prediction.week)) return;
    const timestamp = prediction.date instanceof Date && !Number.isNaN(prediction.date.getTime())
      ? prediction.date.getTime()
      : Number.POSITIVE_INFINITY;
    const isEarlierWeek = !earliest
      || timestamp < earliestTime
      || (timestamp === earliestTime
        && (prediction.season < earliest.season
          || (prediction.season === earliest.season && prediction.week < earliest.week)));
    if (isEarlierWeek) {
      earliest = { season: prediction.season, week: prediction.week };
      earliestTime = timestamp;
    }
  });
  return earliest ? buildWeekKey(earliest.season, earliest.week) : null;
};

const buildWeekSummaries = (predictions) => {
  const weekMap = new Map();
  predictions.forEach((prediction) => {
    if (!Number.isFinite(prediction.season) || !Number.isFinite(prediction.week)) return;
    const key = buildWeekKey(prediction.season, prediction.week);
    const timestamp = prediction.date instanceof Date && !Number.isNaN(prediction.date.getTime())
      ? prediction.date.getTime()
      : Number.POSITIVE_INFINITY;
    const existing = weekMap.get(key);
    if (existing) {
      existing.firstTimestamp = Math.min(existing.firstTimestamp, timestamp);
    } else {
      weekMap.set(key, {
        season: prediction.season,
        week: prediction.week,
        firstTimestamp: timestamp,
      });
    }
  });
  const weekSummaries = Array.from(weekMap.entries())
    .map(([key, value]) => ({ key, ...value }))
    .sort(compareWeeksChronological);
  return { weekMap, weekSummaries };
};

const formatWeekLabel = (season, week, includeSeason = true) => {
  if (!Number.isFinite(season) || !Number.isFinite(week)) return 'Unknown Week';
  return includeSeason ? `Season ${season} · Week ${week}` : `Week ${week}`;
};

const normalizePoint = (point) => {
  const num = Number(point);
  if (!Number.isFinite(num)) return null;
  return num.toFixed(1);
};

const createConsensusBucket = () => ({ values: [], consensus: null });

const addOddsSample = (bucket, outcome, bookTitle) => {
  const odds = toNumber(outcome.price);
  if (odds === null) return;
  bucket.values.push({ odds, book: bookTitle || null });
};

const computeAverageOdds = (bucket) => {
  if (!bucket.values.length) return null;
  const total = bucket.values.reduce((sum, item) => sum + item.odds, 0);
  return {
    odds: total / bucket.values.length,
    sampleSize: bucket.values.length,
  };
};

const finalizePairProbabilities = (entry) => {
  const homeSummary = computeAverageOdds(entry.home);
  const awaySummary = computeAverageOdds(entry.away);
  if (!homeSummary || !awaySummary) return;
  const impliedHome = oddsToProb(homeSummary.odds);
  const impliedAway = oddsToProb(awaySummary.odds);
  if (impliedHome === null || impliedAway === null) return;
  const total = impliedHome + impliedAway;
  if (total <= 0) return;
  entry.home.consensus = {
    odds: homeSummary.odds,
    prob: impliedHome / total,
    sampleSize: homeSummary.sampleSize,
  };
  entry.away.consensus = {
    odds: awaySummary.odds,
    prob: impliedAway / total,
    sampleSize: awaySummary.sampleSize,
  };
};

const buildConsensusMap = (oddsData) => {
  const map = new Map();
  if (!Array.isArray(oddsData)) return map;

  oddsData.forEach((event) => {
    const homeCode = canonicalTeamCode(event.home_team);
    const awayCode = canonicalTeamCode(event.away_team);
    if (!homeCode || !awayCode) return;
    const key = buildPredictionKey(homeCode, awayCode);

    const consensus = {
      homeTeam: event.home_team,
      awayTeam: event.away_team,
      moneyline: {
        home: createConsensusBucket(),
        away: createConsensusBucket(),
      },
      spreads: new Map(),
      totals: new Map(),
    };

    (event.bookmakers || []).forEach((book) => {
      const title = book.title || book.key;
      const markets = book.markets || [];

      const h2h = markets.find((m) => m.key === 'h2h');
      if (h2h) {
        h2h.outcomes.forEach((outcome) => {
          const teamCode = canonicalTeamCode(outcome.name);
          if (teamCode === homeCode) {
            addOddsSample(consensus.moneyline.home, outcome, title);
          } else if (teamCode === awayCode) {
            addOddsSample(consensus.moneyline.away, outcome, title);
          }
        });
      }

      const spreads = markets.find((m) => m.key === 'spreads');
      if (spreads) {
        const homeOutcome = spreads.outcomes?.find((o) => canonicalTeamCode(o.name) === homeCode);
        const awayOutcome = spreads.outcomes?.find((o) => canonicalTeamCode(o.name) === awayCode);
        if (homeOutcome && awayOutcome) {
          const pointKey = normalizePoint(homeOutcome.point);
          if (pointKey !== null) {
            const entry = consensus.spreads.get(pointKey) || {
              pointHome: Number(homeOutcome.point),
              pointAway: Number(awayOutcome.point),
              home: createConsensusBucket(),
              away: createConsensusBucket(),
            };
            addOddsSample(entry.home, homeOutcome, title);
            addOddsSample(entry.away, awayOutcome, title);
            consensus.spreads.set(pointKey, entry);
          }
        }
      }

      const totals = markets.find((m) => m.key === 'totals');
      if (totals) {
        const overOutcome = totals.outcomes?.find((o) => String(o.name).toLowerCase() === 'over');
        const underOutcome = totals.outcomes?.find((o) => String(o.name).toLowerCase() === 'under');
        if (overOutcome && underOutcome) {
          const pointKey = normalizePoint(overOutcome.point);
          if (pointKey !== null) {
            const entry = consensus.totals.get(pointKey) || {
              point: Number(overOutcome.point),
              over: createConsensusBucket(),
              under: createConsensusBucket(),
            };
            addOddsSample(entry.over, overOutcome, title);
            addOddsSample(entry.under, underOutcome, title);
            consensus.totals.set(pointKey, entry);
          }
        }
      }
    });

    if (consensus.moneyline.home.values.length && consensus.moneyline.away.values.length) {
      const homeSummary = computeAverageOdds(consensus.moneyline.home);
      const awaySummary = computeAverageOdds(consensus.moneyline.away);
      if (homeSummary && awaySummary) {
        const impliedHome = oddsToProb(homeSummary.odds);
        const impliedAway = oddsToProb(awaySummary.odds);
        if (impliedHome !== null && impliedAway !== null && impliedHome + impliedAway > 0) {
          const total = impliedHome + impliedAway;
          consensus.moneyline.home.consensus = {
            odds: homeSummary.odds,
            prob: impliedHome / total,
            sampleSize: homeSummary.sampleSize,
          };
          consensus.moneyline.away.consensus = {
            odds: awaySummary.odds,
            prob: impliedAway / total,
            sampleSize: awaySummary.sampleSize,
          };
        }
      }
    }

    consensus.spreads.forEach((entry) => finalizePairProbabilities(entry));
    consensus.totals.forEach((entry) => {
      const overSummary = computeAverageOdds(entry.over);
      const underSummary = computeAverageOdds(entry.under);
      if (!overSummary || !underSummary) return;
      const impliedOver = oddsToProb(overSummary.odds);
      const impliedUnder = oddsToProb(underSummary.odds);
      if (impliedOver !== null && impliedUnder !== null && impliedOver + impliedUnder > 0) {
        const total = impliedOver + impliedUnder;
        entry.over.consensus = {
          odds: overSummary.odds,
          prob: impliedOver / total,
          sampleSize: overSummary.sampleSize,
        };
        entry.under.consensus = {
          odds: underSummary.odds,
          prob: impliedUnder / total,
          sampleSize: underSummary.sampleSize,
        };
      }
    });

    map.set(key, consensus);
  });
  return map;
};

const sampleSizeLabel = (count) => {
  if (!count || count <= 0) return null;
  return count === 1 ? 'Avg of 1 book' : `Avg of ${count} books`;
};

const getConsensusMoneyline = (consensus, side) => {
  if (!consensus || !consensus.moneyline) return null;
  const bucket = consensus.moneyline[side];
  if (!bucket || !bucket.consensus) return null;
  return {
    odds: bucket.consensus.odds,
    prob: bucket.consensus.prob,
    sampleSize: bucket.consensus.sampleSize,
    label: sampleSizeLabel(bucket.consensus.sampleSize),
  };
};

const getConsensusSpread = (consensus, side) => {
  if (!consensus || !consensus.spreads) return null;
  let chosen = null;
  consensus.spreads.forEach((entry) => {
    const bucket = side === 'home' ? entry.home : entry.away;
    if (!bucket || !bucket.consensus) return;
    const sampleSize = bucket.consensus.sampleSize;
    if (!chosen || sampleSize > chosen.sampleSize) {
      chosen = {
        line: side === 'home' ? entry.pointHome : entry.pointAway,
        odds: bucket.consensus.odds,
        prob: bucket.consensus.prob,
        sampleSize,
        label: sampleSizeLabel(sampleSize),
      };
    }
  });
  return chosen;
};

const getConsensusTotal = (consensus, side) => {
  if (!consensus || !consensus.totals) return null;
  let chosen = null;
  consensus.totals.forEach((entry) => {
    const bucket = side === 'over' ? entry.over : entry.under;
    if (!bucket || !bucket.consensus) return;
    const sampleSize = bucket.consensus.sampleSize;
    if (!chosen || sampleSize > chosen.sampleSize) {
      chosen = {
        line: entry.point,
        odds: bucket.consensus.odds,
        prob: bucket.consensus.prob,
        sampleSize,
        label: sampleSizeLabel(sampleSize),
      };
    }
  });
  return chosen;
};

const getDefaultEvInput = () => ({
  moneyline: { home: '', away: '' },
  spread: { home: { line: '', odds: '' }, away: { line: '', odds: '' } },
  total: { over: { line: '', odds: '' }, under: { line: '', odds: '' } },
});

const getEvInput = (gameKey) => {
  if (!state.evInputs[gameKey]) {
    state.evInputs[gameKey] = getDefaultEvInput();
  }
  return state.evInputs[gameKey];
};

const formatOddsInput = (value) => {
  if (value === null || value === undefined || value === '') return '';
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  if (num === 0) return '0';
  return num > 0 ? `+${String(num)}` : String(num);
};

const formatLineInput = (value) => {
  if (value === null || value === undefined || value === '') return '';
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  return Number.isInteger(num) ? String(num) : num.toFixed(1);
};

const clearEvInput = (input) => {
  input.moneyline.home = '';
  input.moneyline.away = '';
  input.spread.home.line = '';
  input.spread.home.odds = '';
  input.spread.away.line = '';
  input.spread.away.odds = '';
  input.total.over.line = '';
  input.total.over.odds = '';
  input.total.under.line = '';
  input.total.under.odds = '';
};

const collectBookOptions = () => {
  const options = new Map();
  state.sportsbookData.forEach((event) => {
    (event.bookmakers || []).forEach((book) => {
      const key = book.key || null;
      if (!key || options.has(key)) return;
      const label = book.title || book.key || key;
      options.set(key, label);
    });
  });
  return Array.from(options.entries()).map(([key, label]) => ({ key, label }));
};

const getSelectedBookLabel = (bookKey) => {
  if (!bookKey || bookKey === 'manual') return null;
  const books = collectBookOptions();
  const entry = books.find((book) => book.key === bookKey);
  return entry ? entry.label : bookKey;
};

const updateBookSelectOptions = () => {
  const select = document.getElementById('bookSelect');
  if (!select) return;
  const books = collectBookOptions().sort((a, b) => a.label.localeCompare(b.label));
  const optionHtml = ['<option value="manual">Manual entry</option>'];
  books.forEach((book) => {
    optionHtml.push(`<option value="${escapeHtml(book.key)}">${escapeHtml(book.label)}</option>`);
  });
  select.innerHTML = optionHtml.join('');
  if (state.evBookSelection !== 'manual' && !books.some((book) => book.key === state.evBookSelection)) {
    state.evBookSelection = 'manual';
  }
  select.value = state.evBookSelection;
  select.disabled = books.length === 0;
};

const buildBookPreset = (bookmaker, homeCode, awayCode) => {
  if (!bookmaker) return null;
  const preset = getDefaultEvInput();
  const markets = bookmaker.markets || [];

  const h2h = markets.find((market) => market.key === 'h2h');
  if (h2h && Array.isArray(h2h.outcomes)) {
    h2h.outcomes.forEach((outcome) => {
      const teamCode = canonicalTeamCode(outcome.name);
      const formatted = formatOddsInput(outcome.price);
      if (formatted === '') return;
      if (teamCode === homeCode) preset.moneyline.home = formatted;
      if (teamCode === awayCode) preset.moneyline.away = formatted;
    });
  }

  const spreads = markets.find((market) => market.key === 'spreads');
  if (spreads && Array.isArray(spreads.outcomes)) {
    const homeOutcome = spreads.outcomes.find((outcome) => canonicalTeamCode(outcome.name) === homeCode);
    const awayOutcome = spreads.outcomes.find((outcome) => canonicalTeamCode(outcome.name) === awayCode);
    if (homeOutcome) {
      const line = formatLineInput(homeOutcome.point);
      const odds = formatOddsInput(homeOutcome.price);
      if (line !== '') preset.spread.home.line = line;
      if (odds !== '') preset.spread.home.odds = odds;
    }
    if (awayOutcome) {
      const line = formatLineInput(awayOutcome.point);
      const odds = formatOddsInput(awayOutcome.price);
      if (line !== '') preset.spread.away.line = line;
      if (odds !== '') preset.spread.away.odds = odds;
    }
  }

  const totals = markets.find((market) => market.key === 'totals');
  if (totals && Array.isArray(totals.outcomes)) {
    const overOutcome = totals.outcomes.find((outcome) => String(outcome.name).toLowerCase() === 'over');
    const underOutcome = totals.outcomes.find((outcome) => String(outcome.name).toLowerCase() === 'under');
    if (overOutcome) {
      const line = formatLineInput(overOutcome.point);
      const odds = formatOddsInput(overOutcome.price);
      if (line !== '') {
        preset.total.over.line = line;
        if (preset.total.under.line === '') preset.total.under.line = line;
      }
      if (odds !== '') preset.total.over.odds = odds;
    }
    if (underOutcome) {
      const line = formatLineInput(underOutcome.point);
      const odds = formatOddsInput(underOutcome.price);
      if (line !== '') {
        preset.total.under.line = line;
        if (preset.total.over.line === '') preset.total.over.line = line;
      }
      if (odds !== '') preset.total.under.odds = odds;
    }
  }

  const hasValue = (
    preset.moneyline.home !== ''
    || preset.moneyline.away !== ''
    || preset.spread.home.line !== ''
    || preset.spread.home.odds !== ''
    || preset.spread.away.line !== ''
    || preset.spread.away.odds !== ''
    || preset.total.over.line !== ''
    || preset.total.over.odds !== ''
    || preset.total.under.line !== ''
    || preset.total.under.odds !== ''
  );

  return hasValue ? preset : null;
};

const applyBookPreset = (bookKey, options = {}) => {
  if (!bookKey || bookKey === 'manual') return;
  if (!state.sportsbookData.length) return;
  const { onlyEmpty = false } = options;
  const predictions = state.predictions || [];
  if (!predictions.length) return;

  const eventMap = new Map();
  state.sportsbookData.forEach((event) => {
    const homeCode = canonicalTeamCode(event.home_team);
    const awayCode = canonicalTeamCode(event.away_team);
    if (!homeCode || !awayCode) return;
    eventMap.set(buildPredictionKey(homeCode, awayCode), event);
  });

  predictions.forEach((prediction) => {
    const gameKey = buildPredictionKey(prediction.homeTeam, prediction.awayTeam);
    const event = eventMap.get(gameKey);
    if (!event) return;
    const bookmaker = (event.bookmakers || []).find((book) => book.key === bookKey);
    if (!bookmaker) return;
    const preset = buildBookPreset(bookmaker, prediction.homeTeam, prediction.awayTeam);
    if (!preset) return;
    const target = getEvInput(gameKey);
    if (!onlyEmpty) {
      clearEvInput(target);
    }

    ['home', 'away'].forEach((side) => {
      const value = preset.moneyline[side];
      if (value === '') return;
      if (onlyEmpty && target.moneyline[side] !== '') return;
      target.moneyline[side] = value;
    });

    ['home', 'away'].forEach((side) => {
      ['line', 'odds'].forEach((field) => {
        const value = preset.spread[side][field];
        if (value === '') return;
        if (onlyEmpty && target.spread[side][field] !== '') return;
        target.spread[side][field] = value;
      });
    });

    ['over', 'under'].forEach((side) => {
      ['line', 'odds'].forEach((field) => {
        const value = preset.total[side][field];
        if (value === '') return;
        if (onlyEmpty && target.total[side][field] !== '') return;
        target.total[side][field] = value;
      });
    });
  });
};

const describeAutoMeta = (meta) => {
  if (!meta) return '';
  const parts = [];
  if (meta.seasons && meta.seasons.length) {
    const first = meta.seasons[0];
    const last = meta.seasons[meta.seasons.length - 1];
    parts.push(meta.seasons.length > 1 ? `seasons ${first}-${last}` : `season ${first}`);
  }
  if (meta.completedGames) parts.push(`${meta.completedGames} completed games`);
  if (meta.upcomingGames) parts.push(`${meta.upcomingGames} upcoming games`);
  if (meta.lastUpdated) parts.push(`updated ${meta.lastUpdated}`);
  return parts.join(', ');
};

const formatNumber = (value, digits = 3) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return Number(value).toFixed(digits);
};

const formatPercent = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return `${(value * 100).toFixed(1)}%`;
};

const formatSignedPercent = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  const pct = value * 100;
  const formatted = pct.toFixed(1);
  return `${pct > 0 ? '+' : ''}${formatted}%`;
};

const formatMoneyline = (value) => {
  if (value === null || value === undefined || value === '') return '-';
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  const rounded = Math.round(num);
  if (rounded === 0) return '0';
  return rounded > 0 ? `+${rounded}` : String(rounded);
};

const formatEv = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return `${(value * 100).toFixed(1)}%`;
};

const formatSpreadLine = (value) => {
  if (value === null || value === undefined || value === '') return '-';
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  const formatted = num.toFixed(1);
  return num > 0 ? `+${formatted}` : formatted;
};

const formatSigned = (value, digits = 1) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  const num = Number(value);
  const formatted = num.toFixed(digits);
  return num > 0 ? `+${formatted}` : formatted;
};

const probabilityHomeCovers = (prediction, spreadLine) => {
  if (!prediction) return null;
  const eloDiff = prediction.ratingDiff - (spreadLine * CONFIG.spreadFactor);
  return logistic(eloDiff);
};

const probabilityOverHits = () => null; // totals rely on consensus only for now.

const renderRatingsTable = (ratings, meta) => {
  if (!ratings || !ratings.length) {
    return '<p class="hint">Run the model to generate team ratings.</p>';
  }
  const rows = ratings.map((row, index) => {
    const last = row.lastGameDate ? new Date(row.lastGameDate).toISOString().slice(0, 10) : '-';
    return `
      <tr>
        <td data-sort-value="${index + 1}">${index + 1}</td>
        <td data-sort-value="${row.team}">${row.team}</td>
        <td data-sort-value="${row.rating}">${formatNumber(row.rating, 1)}</td>
        <td data-sort-value="${row.gamesPlayed}">${row.gamesPlayed}</td>
        <td data-sort-value="${row.lastGameDate ? new Date(row.lastGameDate).getTime() : ''}">${last}</td>
      </tr>
    `;
  }).join('');
  const subtitle = describeAutoMeta(meta);
  return `
    <section class="collapsible" data-section="ratings">
      <div class="collapsible-header" role="button" tabindex="0" aria-expanded="true">Team Ratings</div>
      <div class="collapsible-body">
        ${subtitle ? `<p class="status meta">${subtitle}</p>` : ''}
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

const hasMarketValues = (value) => value !== null && value !== undefined && !Number.isNaN(value);

const renderPredictionsTable = (predictions) => {
  if (!predictions || !predictions.length) {
    return '<p class="hint">Load upcoming games (CSV or auto-fetch) before running the model.</p>';
  }

  const { weekMap, weekSummaries: weekOptionsData } = buildWeekSummaries(predictions);

  let selectedWeekKey = state.eloWeekFilter;
  const availableWeekKeys = new Set(weekOptionsData.map((option) => option.key));
  if (!selectedWeekKey || !availableWeekKeys.has(selectedWeekKey)) {
    selectedWeekKey = weekOptionsData.length ? weekOptionsData[0].key : null;
    if (state.eloWeekFilter !== selectedWeekKey) {
      state.eloWeekFilter = selectedWeekKey;
    }
  }
  const baseWeekFiltered = selectedWeekKey
    ? predictions.filter((prediction) => buildWeekKey(prediction.season, prediction.week) === selectedWeekKey)
    : predictions;

  const gameMap = new Map();
  baseWeekFiltered.forEach((prediction) => {
    const key = buildPredictionKey(prediction.homeTeam, prediction.awayTeam);
    if (!gameMap.has(key)) {
      const weekLabel = formatWeekLabel(prediction.season, prediction.week, weekOptionsData.length > 1);
      gameMap.set(key, `${prediction.awayTeam} @ ${prediction.homeTeam} (${weekLabel})`);
    }
  });

  let selectedGameKey = state.eloGameFilter;
  if (selectedGameKey && !gameMap.has(selectedGameKey)) {
    selectedGameKey = null;
    state.eloGameFilter = null;
  }

  const baseFiltered = selectedGameKey ? baseWeekFiltered.filter((prediction) => buildPredictionKey(prediction.homeTeam, prediction.awayTeam) === selectedGameKey) : baseWeekFiltered;

  const marketDataPresent = baseFiltered.some((row) => hasMarketValues(row.marketSpread) || hasMarketValues(row.homeMoneyline));
  const usablePredictions = marketDataPresent
    ? baseFiltered.filter((row) => [
      row.marketSpread,
      row.homeSpreadEdge,
      row.homeMoneyline,
      row.homeMoneylineEdge,
    ].every(hasMarketValues))
    : baseFiltered;

  const includeSeasonInLabel = weekOptionsData.length > 1;
  const weekOptionsHtml = weekOptionsData.length
    ? weekOptionsData.map((option) => {
      const selectedAttr = option.key === selectedWeekKey ? ' selected' : '';
      return `<option value="${escapeHtml(option.key)}"${selectedAttr}>${escapeHtml(formatWeekLabel(option.season, option.week, includeSeasonInLabel))}</option>`;
    }).join('')
    : '<option value="" disabled>No weeks available</option>';

  const gameOptionsHtml = [
    `<option value=""${selectedGameKey ? '' : ' selected'}>All Games</option>`,
    ...Array.from(gameMap.entries()).map(([key, label]) => {
      const selectedAttr = key === selectedGameKey ? ' selected' : '';
      return `<option value="${escapeHtml(key)}"${selectedAttr}>${escapeHtml(label)}</option>`;
    }),
  ].join('');

  const filtersHtml = `
    <div class="ev-controls elo-filters">
      <label for="eloWeekSelect" class="ev-select-label">Week</label>
      <select id="eloWeekSelect">${weekOptionsHtml}</select>
      <label for="eloGameSelect" class="ev-select-label">Game</label>
      <select id="eloGameSelect">${gameOptionsHtml}</select>
    </div>
  `;

  if (!usablePredictions.length) {
    const message = baseFiltered.length
      ? '<p class="hint">No games with complete market data match the selected filters.</p>'
      : '<p class="hint">No upcoming games match the selected filters.</p>';
    return `
      <section class="collapsible" data-section="predictions">
        <div class="collapsible-header" role="button" tabindex="0" aria-expanded="true">Upcoming Games</div>
        <div class="collapsible-body">
          ${filtersHtml}
          ${message}
        </div>
      </section>
    `;
  }

  const rows = usablePredictions.map((row) => {
    const modelSpreadDisplay = formatSpreadLine(row.modelSpread);
    const marketSpreadDisplay = formatSpreadLine(row.marketSpread);
    const spreadEdgeDisplay = row.homeSpreadEdge === null || row.homeSpreadEdge === undefined
      ? '-'
      : `${formatSigned(row.homeSpreadEdge, 1)} pts`;
    const projectedMoneylineDisplay = formatMoneyline(row.homeFairMoneyline);
    const sportsbookMoneylineDisplay = formatMoneyline(row.homeMoneyline);
    const mlEdgeDisplay = row.homeMoneylineEdge === null || row.homeMoneylineEdge === undefined
      ? '-'
      : formatSignedPercent(row.homeMoneylineEdge);
    const spreadEdgeNumeric = Number(row.homeSpreadEdge);
    const moneylineEdgeNumeric = Number(row.homeMoneylineEdge);
    const hasSpreadEdge = row.homeSpreadEdge !== null && row.homeSpreadEdge !== undefined && row.homeSpreadEdge !== '' && Number.isFinite(spreadEdgeNumeric);
    const hasMoneylineEdge = row.homeMoneylineEdge !== null && row.homeMoneylineEdge !== undefined && row.homeMoneylineEdge !== '' && Number.isFinite(moneylineEdgeNumeric);
    let recommendation = 'No Bet';
    if (hasSpreadEdge && spreadEdgeNumeric > 0) {
      recommendation = 'Bet Home Spread';
    } else if (hasMoneylineEdge && moneylineEdgeNumeric > 0) {
      recommendation = 'Bet Home ML';
    }
    return `
      <tr>
        <td data-sort-value="${row.homeTeam}">${row.homeTeam}</td>
        <td data-sort-value="${row.awayTeam}">${row.awayTeam}</td>
        <td data-sort-value="${row.homeWinProb}">${formatPercent(row.homeWinProb)}</td>
        <td data-sort-value="${row.modelSpread ?? ''}">${modelSpreadDisplay}</td>
        <td data-sort-value="${row.marketSpread ?? ''}">${marketSpreadDisplay}</td>
        <td data-sort-value="${row.homeSpreadEdge ?? ''}">${spreadEdgeDisplay}</td>
        <td data-sort-value="${row.homeFairMoneyline ?? ''}">${projectedMoneylineDisplay}</td>
        <td data-sort-value="${row.homeMoneyline ?? ''}">${sportsbookMoneylineDisplay}</td>
        <td data-sort-value="${row.homeMoneylineEdge ?? ''}">${mlEdgeDisplay}</td>
        <td data-sort-value="${recommendation}">${recommendation}</td>
      </tr>
    `;
  }).join('');

  const explainer = '<p class="hint explanation">Model Win % converts Elo rating differences into a home victory probability. Projected Spread and Projected ML Odds come from the model; Sportsbook columns use uploaded lines or The Odds API consensus. Spread Value and Moneyline Value highlight edges versus the market and drive the automated Recommended Bet.</p>';

  return `
    <section class="collapsible" data-section="predictions">
      <div class="collapsible-header" role="button" tabindex="0" aria-expanded="true">Upcoming Games</div>
      <div class="collapsible-body">
        ${filtersHtml}
        ${explainer}
        <table class="data-table" data-sortable="true">
          <thead>
            <tr class="group-header">
              <th colspan="3">Basic Info</th>
              <th colspan="3">Spread</th>
              <th colspan="3">Moneyline</th>
              <th colspan="1">Recommendation</th>
            </tr>
            <tr>
              <th data-sort-key="home" data-sort-type="text" title="${getHeaderTooltip('predictions','home')}">Home</th>
              <th data-sort-key="away" data-sort-type="text" title="${getHeaderTooltip('predictions','away')}">Away</th>
              <th data-sort-key="prob" data-sort-type="number" title="${getHeaderTooltip('predictions','prob')}">Model Win % (Home)</th>
              <th data-sort-key="spread" data-sort-type="number" title="${getHeaderTooltip('predictions','spread')}">Projected Spread</th>
              <th data-sort-key="marketspread" data-sort-type="number" title="${getHeaderTooltip('predictions','marketspread')}">Sportsbook Spread</th>
              <th data-sort-key="spreadedge" data-sort-type="number" title="${getHeaderTooltip('predictions','spreadedge')}">Spread Value (+/- pts)</th>
              <th data-sort-key="fairml" data-sort-type="number" title="${getHeaderTooltip('predictions','fairml')}">Projected ML Odds</th>
              <th data-sort-key="ml" data-sort-type="number" title="${getHeaderTooltip('predictions','ml')}">Sportsbook ML Odds</th>
              <th data-sort-key="mledge" data-sort-type="number" title="${getHeaderTooltip('predictions','mledge')}">Moneyline Value %</th>
              <th data-sort-key="recommendation" data-sort-type="text">Recommended Bet</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>
  `;
};

const createMoneylineMetrics = (prediction, consensus, inputs, side) => {
  const oddsRaw = inputs.moneyline[side];
  const numericOdds = oddsRaw === '' ? null : Number(oddsRaw);
  const validOdds = Number.isFinite(numericOdds) ? numericOdds : null;
  const consensusPoint = getConsensusMoneyline(consensus, side);
  const consensusProb = consensusPoint?.prob ?? null;
  const consensusOdds = consensusPoint?.odds ?? null;
  const implied = validOdds === null ? null : oddsToProb(validOdds);
  const probabilityEdge = implied === null || consensusProb === null ? null : consensusProb - implied;
  const marketEv = validOdds === null || consensusProb === null ? null : expectedValue(consensusProb, validOdds);
  const fairOdds = consensusProb === null ? null : probToMoneyline(consensusProb);
  return {
    odds: validOdds,
    implied,
    consensusProb,
    probabilityEdge,
    marketEv,
    consensusOdds,
    fairOdds,
    consensusLine: null,
    bestBook: consensusPoint?.label || null,
    sampleSize: consensusPoint?.sampleSize ?? null,
  };
};

const getSpreadEntry = (consensus, line, side) => {
  if (!consensus || !consensus.spreads || !consensus.spreads.size) return null;
  const targetLine = Number.isFinite(line) ? Number(line) : null;
  const tolerance = 0.05;
  let best = null;
  let bestMeta = null;
  consensus.spreads.forEach((entry) => {
    const bucket = side === 'home' ? entry.home : entry.away;
    if (!bucket || !bucket.consensus) return;
    const consensusLine = side === 'home' ? entry.pointHome : entry.pointAway;
    const diff = targetLine === null ? 0 : Math.abs(consensusLine - targetLine);
    const isExact = targetLine !== null && diff <= tolerance;
    const sampleSize = bucket.consensus.sampleSize || 0;
    const metadata = { diff, isExact, sampleSize };
    if (!best) {
      best = {
        line: consensusLine,
        odds: bucket.consensus.odds,
        prob: bucket.consensus.prob,
        sampleSize,
      };
      bestMeta = metadata;
      return;
    }
    let replace = false;
    if (metadata.isExact && !bestMeta.isExact) {
      replace = true;
    } else if (metadata.isExact === bestMeta.isExact) {
      if (targetLine !== null) {
        if (metadata.diff < bestMeta.diff - 1e-6) {
          replace = true;
        } else if (Math.abs(metadata.diff - bestMeta.diff) <= 1e-6 && metadata.sampleSize > bestMeta.sampleSize) {
          replace = true;
        }
      } else if (metadata.sampleSize > bestMeta.sampleSize) {
        replace = true;
      }
    }
    if (replace) {
      best = {
        line: consensusLine,
        odds: bucket.consensus.odds,
        prob: bucket.consensus.prob,
        sampleSize,
      };
      bestMeta = metadata;
    }
  });
  return best;
};

const createSpreadMetrics = (prediction, consensus, inputs, side) => {
  const data = inputs.spread[side];
  const rawLine = data.line;
  const rawOdds = data.odds;
  const line = rawLine === '' ? null : Number(rawLine);
  const odds = rawOdds === '' ? null : Number(rawOdds);
  const validLine = Number.isFinite(line) ? line : null;
  const validOdds = Number.isFinite(odds) ? odds : null;
  const consensusEntry = getSpreadEntry(consensus, validLine, side);
  const consensusProb = consensusEntry?.prob ?? null;
  const implied = validOdds === null ? null : oddsToProb(validOdds);
  const probabilityEdge = implied === null || consensusProb === null ? null : consensusProb - implied;
  const marketEv = validOdds === null || consensusProb === null ? null : expectedValue(consensusProb, validOdds);
  const fairOdds = consensusProb === null ? null : probToMoneyline(consensusProb);
  return {
    line: validLine,
    odds: validOdds,
    implied,
    consensusProb,
    probabilityEdge,
    marketEv,
    fairOdds,
    consensusOdds: consensusEntry?.odds ?? null,
    consensusLine: consensusEntry?.line ?? null,
    bestBook: consensusEntry ? sampleSizeLabel(consensusEntry.sampleSize) : null,
  };
};

const collectBestEvBets = (predictions) => {
  const bets = [];
  const computeEdge = (metrics) => (metrics.probabilityEdge ?? null);

  predictions.forEach((prediction) => {
    const gameKey = buildPredictionKey(prediction.homeTeam, prediction.awayTeam);
    const evInput = state.evInputs[gameKey];
    if (!evInput) return;
    const consensus = state.consensusMap.get(gameKey) || null;
    const matchup = `${prediction.awayTeam} @ ${prediction.homeTeam}`;

    ['home', 'away'].forEach((side) => {
      const metrics = createMoneylineMetrics(prediction, consensus, evInput, side);
      if (metrics.odds === null || metrics.marketEv === null || metrics.marketEv <= 0) return;
      if (metrics.consensusProb === null || metrics.implied === null) return;
      if (metrics.probabilityEdge === null || metrics.probabilityEdge <= 0) return;
      const team = side === 'home' ? prediction.homeTeam : prediction.awayTeam;
      bets.push({
        key: `${gameKey}|moneyline|${side}`,
        type: 'moneyline',
        matchup,
        label: `${team} ML`,
        odds: metrics.odds,
        marketOdds: metrics.consensusOdds ?? null,
        fairOdds: metrics.fairOdds ?? null,
        marketLine: null,
        userLine: null,
        consensusProb: metrics.consensusProb,
        impliedProb: metrics.implied,
        probabilityEdge: computeEdge(metrics),
        marketEv: metrics.marketEv,
      });
    });

    ['home', 'away'].forEach((side) => {
      const metrics = createSpreadMetrics(prediction, consensus, evInput, side);
      if (metrics.line === null || metrics.odds === null || metrics.marketEv === null || metrics.marketEv <= 0) return;
      if (metrics.consensusProb === null || metrics.implied === null) return;
      if (metrics.probabilityEdge === null || metrics.probabilityEdge <= 0) return;
      const team = side === 'home' ? prediction.homeTeam : prediction.awayTeam;
      const lineDisplay = formatSpreadLine(metrics.line);
      bets.push({
        key: `${gameKey}|spread|${side}`,
        type: 'spread',
        matchup,
        label: `${team} ${lineDisplay} (Spread)`,
        odds: metrics.odds,
        marketOdds: metrics.consensusOdds ?? null,
        fairOdds: metrics.fairOdds ?? null,
        marketLine: metrics.consensusLine ?? null,
        userLine: metrics.line,
        consensusProb: metrics.consensusProb,
        impliedProb: metrics.implied,
        probabilityEdge: computeEdge(metrics),
        marketEv: metrics.marketEv,
      });
    });

    ['over', 'under'].forEach((side) => {
      const metrics = createTotalMetrics(consensus, evInput, side);
      if (metrics.line === null || metrics.odds === null || metrics.marketEv === null || metrics.marketEv <= 0) return;
      if (metrics.consensusProb === null || metrics.implied === null) return;
      if (metrics.probabilityEdge === null || metrics.probabilityEdge <= 0) return;
      const labelPrefix = side === 'over' ? 'Over' : 'Under';
      bets.push({
        key: `${gameKey}|total|${side}`,
        type: 'total',
        matchup,
        label: `${labelPrefix} ${formatNumber(metrics.line, 1)} (Total)`,
        odds: metrics.odds,
        marketOdds: metrics.consensusOdds ?? null,
        fairOdds: metrics.fairOdds ?? null,
        marketLine: metrics.consensusLine ?? null,
        userLine: metrics.line,
        consensusProb: metrics.consensusProb,
        impliedProb: metrics.implied,
        probabilityEdge: computeEdge(metrics),
        marketEv: metrics.marketEv,
      });
    });
  });

  bets.sort((a, b) => {
    const evA = typeof a.marketEv === 'number' ? a.marketEv : Number.NEGATIVE_INFINITY;
    const evB = typeof b.marketEv === 'number' ? b.marketEv : Number.NEGATIVE_INFINITY;
    if (evA === evB) {
      const edgeA = typeof a.probabilityEdge === 'number' ? a.probabilityEdge : Number.NEGATIVE_INFINITY;
      const edgeB = typeof b.probabilityEdge === 'number' ? b.probabilityEdge : Number.NEGATIVE_INFINITY;
      return edgeB - edgeA;
    }
    return evB - evA;
  });

  return bets;
};

const getTotalEntry = (consensus, line, side) => {
  if (!consensus || !consensus.totals || !consensus.totals.size) return null;
  const targetLine = Number.isFinite(line) ? Number(line) : null;
  const tolerance = 0.05;
  let best = null;
  let bestMeta = null;
  consensus.totals.forEach((entry) => {
    const bucket = side === 'over' ? entry.over : entry.under;
    if (!bucket || !bucket.consensus) return;
    const consensusLine = entry.point;
    const diff = targetLine === null ? 0 : Math.abs(consensusLine - targetLine);
    const isExact = targetLine !== null && diff <= tolerance;
    const sampleSize = bucket.consensus.sampleSize || 0;
    const metadata = { diff, isExact, sampleSize };
    if (!best) {
      best = {
        line: consensusLine,
        odds: bucket.consensus.odds,
        prob: bucket.consensus.prob,
        sampleSize,
      };
      bestMeta = metadata;
      return;
    }
    let replace = false;
    if (metadata.isExact && !bestMeta.isExact) {
      replace = true;
    } else if (metadata.isExact === bestMeta.isExact) {
      if (targetLine !== null) {
        if (metadata.diff < bestMeta.diff - 1e-6) {
          replace = true;
        } else if (Math.abs(metadata.diff - bestMeta.diff) <= 1e-6 && metadata.sampleSize > bestMeta.sampleSize) {
          replace = true;
        }
      } else if (metadata.sampleSize > bestMeta.sampleSize) {
        replace = true;
      }
    }
    if (replace) {
      best = {
        line: consensusLine,
        odds: bucket.consensus.odds,
        prob: bucket.consensus.prob,
        sampleSize,
      };
      bestMeta = metadata;
    }
  });
  return best;
};

const applyConsensusToPredictions = () => {
  if (!state.predictions || !state.predictions.length || !state.consensusMap.size) return;
  let changed = false;
  const updated = state.predictions.map((prediction) => {
    const consensus = state.consensusMap.get(buildPredictionKey(prediction.homeTeam, prediction.awayTeam));
    if (!consensus) return prediction;
    const clone = { ...prediction };
    let mutated = false;

    const homeMlNode = getConsensusMoneyline(consensus, 'home');
    if (homeMlNode && Number.isFinite(homeMlNode.odds)) {
      clone.homeMoneyline = homeMlNode.odds;
      const implied = Number.isFinite(homeMlNode.prob) ? homeMlNode.prob : oddsToProb(homeMlNode.odds);
      clone.homeMoneylineImplied = implied;
      clone.homeMoneylineEdge = implied === null ? null : clone.homeWinProb - implied;
      mutated = true;
    }

    const awayMlNode = getConsensusMoneyline(consensus, 'away');
    if (awayMlNode && Number.isFinite(awayMlNode.odds)) {
      clone.awayMoneyline = awayMlNode.odds;
      const implied = Number.isFinite(awayMlNode.prob) ? awayMlNode.prob : oddsToProb(awayMlNode.odds);
      clone.awayMoneylineImplied = implied;
      clone.awayMoneylineEdge = implied === null ? null : clone.awayWinProb - implied;
      mutated = true;
    }

    const homeSpreadConsensus = getConsensusSpread(consensus, 'home');
    if (homeSpreadConsensus && Number.isFinite(homeSpreadConsensus.line)) {
      clone.marketSpread = homeSpreadConsensus.line;
      clone.homeSpreadEdge = homeSpreadConsensus.line - clone.modelSpread;
      mutated = true;
    }

    const totalConsensus = getConsensusTotal(consensus, 'over');
    if (totalConsensus && Number.isFinite(totalConsensus.line)) {
      clone.marketTotal = totalConsensus.line;
      mutated = true;
    }

    if (mutated) changed = true;
    return mutated ? clone : prediction;
  });
  if (changed) {
    state.predictions = updated;
    state.predictionMap = buildPredictionMap(state.predictions);
  } else {
    state.predictions = updated;
  }
};

const createTotalMetrics = (consensus, inputs, side) => {
  const data = inputs.total[side];
  const rawLine = data.line;
  const rawOdds = data.odds;
  const line = rawLine === '' ? null : Number(rawLine);
  const odds = rawOdds === '' ? null : Number(rawOdds);
  const validLine = Number.isFinite(line) ? line : null;
  const validOdds = Number.isFinite(odds) ? odds : null;
  const consensusEntry = getTotalEntry(consensus, validLine, side);
  const consensusProb = consensusEntry?.prob ?? null;
  const implied = validOdds === null ? null : oddsToProb(validOdds);
  const probabilityEdge = implied === null || consensusProb === null ? null : consensusProb - implied;
  const marketEv = validOdds === null || consensusProb === null ? null : expectedValue(consensusProb, validOdds);
  const fairOdds = consensusProb === null ? null : probToMoneyline(consensusProb);
  return {
    line: validLine,
    odds: validOdds,
    implied,
    consensusProb,
    probabilityEdge,
    marketEv,
    fairOdds,
    consensusOdds: consensusEntry?.odds ?? null,
    consensusLine: consensusEntry?.line ?? null,
    bestBook: consensusEntry ? sampleSizeLabel(consensusEntry.sampleSize) : null,
  };
};

const renderEvCalculator = (focusInfo) => {
  const container = document.getElementById('evContent');
  if (!container) return;

  const predictions = state.predictions || [];
  if (!predictions.length) {
    state.evSelectedGame = null;
    container.innerHTML = '<p class="hint">Run the model first to populate matchups.</p>';
    return;
  }

  const weekValues = Array.from(new Set(predictions
    .map((prediction) => prediction.week)
    .filter((week) => week !== null && week !== undefined))).sort((a, b) => a - b);

  if (state.evWeekFilter !== null && !weekValues.includes(state.evWeekFilter)) {
    state.evWeekFilter = null;
  }

  const filteredPredictions = state.evWeekFilter === null
    ? predictions
    : predictions.filter((prediction) => prediction.week === state.evWeekFilter);

  const activePredictions = filteredPredictions.length ? filteredPredictions : predictions;
  if (filteredPredictions.length === 0 && state.evWeekFilter !== null) {
    state.evWeekFilter = null;
  }

  if (state.evSelectedGame && !state.predictionMap.has(state.evSelectedGame)) {
    state.evSelectedGame = null;
  }

  const activeKeys = new Set(activePredictions.map((prediction) => buildPredictionKey(prediction.homeTeam, prediction.awayTeam)));

  if (state.evSelectedGame && !activeKeys.has(state.evSelectedGame)) {
    state.evSelectedGame = null;
  }

  if (!state.evSelectedGame) {
    const first = activePredictions[0];
    if (first) {
      state.evSelectedGame = buildPredictionKey(first.homeTeam, first.awayTeam);
    }
  }

  const selectedWeek = state.evWeekFilter !== null ? String(state.evWeekFilter) : '';
  const weekOptions = [
    `<option value=""${selectedWeek === '' ? ' selected' : ''}>All Weeks</option>`,
    ...weekValues.map((week) => {
      const value = String(week);
      const selectedAttr = selectedWeek === value ? ' selected' : '';
      return `<option value="${value}"${selectedAttr}>Week ${escapeHtml(String(week))}</option>`;
    }),
  ].join('');

  const gameOptions = activePredictions.map((prediction) => {
    const key = buildPredictionKey(prediction.homeTeam, prediction.awayTeam);
    const label = `${prediction.awayTeam} @ ${prediction.homeTeam}`;
    const selectedAttr = key === state.evSelectedGame ? ' selected' : '';
    return `<option value="${key}"${selectedAttr}>${escapeHtml(label)}</option>`;
  }).join('');

  const controlsHtml = `
    <div class="ev-controls">
      <label for="evWeekSelect" class="ev-select-label">Week</label>
      <select id="evWeekSelect">${weekOptions}</select>
      <label for="evGameSelect" class="ev-select-label">Matchup</label>
      <select id="evGameSelect">${gameOptions}</select>
    </div>
  `;

  if (!state.evSelectedGame) {
    container.innerHTML = `
      ${controlsHtml}
      <p class="hint">Select a matchup to view expected value inputs.</p>
    `;
    attachEvInputs();
    return;
  }

  const selectedKey = state.evSelectedGame;
  const prediction = state.predictionMap.get(selectedKey);
  if (!prediction) {
    container.innerHTML = `
      ${controlsHtml}
      <p class="hint">Select a matchup to view expected value inputs.</p>
    `;
    attachEvInputs();
    return;
  }

  const consensus = state.consensusMap.get(selectedKey) || null;
  const inputs = getEvInput(selectedKey);

  const metricRow = (label, value) => `
    <div class="ev-metric">
      <span class="ev-metric-label">${label}</span>
      <span class="ev-metric-value">${value}</span>
    </div>
  `;

  const detailRow = (label, value) => `
    <div class="ev-detail">
      <span class="ev-detail-label">${label}</span>
      <span class="ev-detail-value">${value}</span>
    </div>
  `;

  const describeConsensus = (label, odds, descriptor) => {
    if ((label === null || label === undefined || label === '') && (odds === null || odds === undefined)) return '-';
    const pieces = [];
    if (label !== null && label !== undefined && label !== '') pieces.push(label);
    if (odds !== null && odds !== undefined && !Number.isNaN(Number(odds))) {
      const num = Number(odds);
      const rounded = Math.round(num);
      pieces.push(rounded > 0 ? `+${rounded}` : String(rounded));
    }
    const textParts = pieces.join(' · ');
    return `${textParts}${descriptor ? ` (${descriptor})` : ''}`;
  };

  const getSignSymbol = (rawValue, fallback) => {
    if (typeof rawValue === 'string') {
      const trimmed = rawValue.trim();
      if (trimmed.startsWith('-')) return '-';
      if (trimmed.startsWith('+')) return '+';
      if (trimmed.length) return '+';
    }
    if (fallback !== null && fallback !== undefined && fallback !== '') {
      const num = Number(fallback);
      if (Number.isFinite(num)) return num < 0 ? '-' : '+';
    }
    return '+';
  };

  const renderSignToggle = (gameKey, evType, side, field, rawValue, fallback) => {
    const sign = getSignSymbol(rawValue, fallback);
    return `<button type="button" class="ev-sign-toggle" data-ev-sign-toggle data-game="${gameKey}" data-ev-type="${evType}" data-ev-side="${side}" data-ev-field="${field}" aria-label="Toggle sign">${sign}</button>`;
  };

  const groupSection = (title, cards) => `
    <section class="ev-group">
      <div class="ev-group-title">${title}</div>
      <div class="ev-group-grid">
        ${cards.join('')}
      </div>
    </section>
  `;

  const mlHome = createMoneylineMetrics(prediction, consensus, inputs, 'home');
  const mlAway = createMoneylineMetrics(prediction, consensus, inputs, 'away');
  const spreadHome = createSpreadMetrics(prediction, consensus, inputs, 'home');
  const spreadAway = createSpreadMetrics(prediction, consensus, inputs, 'away');
  const totalOver = createTotalMetrics(consensus, inputs, 'over');
  const totalUnder = createTotalMetrics(consensus, inputs, 'under');

  const spreadConsensus = {
    home: getConsensusSpread(consensus, 'home'),
    away: getConsensusSpread(consensus, 'away'),
  };
  const totalConsensus = {
    over: getConsensusTotal(consensus, 'over'),
    under: getConsensusTotal(consensus, 'under'),
  };
  const moneylineConsensus = {
    home: getConsensusMoneyline(consensus, 'home'),
    away: getConsensusMoneyline(consensus, 'away'),
  };

  const dateLabel = prediction.date ? new Date(prediction.date).toISOString().slice(0, 10) : '';

  const spreadCard = (side, metrics, best, inputData) => {
    const marketLine = metrics.consensusLine ?? best?.line ?? null;
    const marketOdds = metrics.consensusOdds ?? best?.odds ?? null;
    const consensusDescriptor = best?.label ?? null;
    const probabilityEdge = metrics.probabilityEdge;
    const marketEv = metrics.marketEv;
    const lineDiff = marketLine === null || metrics.line === null ? null : metrics.line - marketLine;
    const placeholderLine = marketLine === null ? '' : formatSpreadLine(marketLine);
    const placeholderOdds = (() => {
      if (marketOdds === null || marketOdds === undefined) return '';
      const formatted = formatMoneyline(marketOdds);
      return formatted === '-' ? '' : formatted;
    })();
    const rawLineValue = inputData.line;
    const rawOddsValue = inputData.odds;
    const lineValue = escapeHtml(rawLineValue);
    const oddsValue = escapeHtml(rawOddsValue);
    const lineToggle = renderSignToggle(selectedKey, 'spread', side, 'line', rawLineValue, marketLine);
    const oddsToggle = renderSignToggle(selectedKey, 'spread', side, 'odds', rawOddsValue, marketOdds);
    const fairOddsDisplay = metrics.fairOdds === null ? '-' : formatMoneyline(metrics.fairOdds);
    return `
      <div class="ev-card">
        <div class="ev-card-header">
          <span class="ev-card-team">${side === 'home' ? prediction.homeTeam : prediction.awayTeam}</span>
          <span class="ev-tag">Spread</span>
        </div>
        <div class="ev-card-details">
          ${detailRow('Market Line', describeConsensus(marketLine === null ? '' : formatSpreadLine(marketLine), marketOdds, consensusDescriptor))}
          ${detailRow('No-Vig Win %', formatPercent(metrics.consensusProb))}
          ${detailRow('Your Win %', formatPercent(metrics.implied))}
          ${detailRow('Fair Odds (No-Vig)', fairOddsDisplay)}
          ${lineDiff === null ? '' : detailRow('Line vs Market', `${formatSigned(lineDiff, 1)} pts`)}
        </div>
        <div class="ev-inputs">
          <div class="ev-input-row">
            <label>Line
              <div class="ev-input-wrapper">
                ${lineToggle}
                <input type="text" inputmode="decimal" data-ev-input data-ev-type="spread" data-ev-side="${side}" data-ev-field="line" data-game="${selectedKey}" value="${lineValue}" placeholder="${escapeHtml(placeholderLine)}" />
              </div>
            </label>
            <label>Odds
              <div class="ev-input-wrapper">
                ${oddsToggle}
                <input type="text" inputmode="numeric" data-ev-input data-ev-type="spread" data-ev-side="${side}" data-ev-field="odds" data-game="${selectedKey}" value="${oddsValue}" placeholder="${escapeHtml(placeholderOdds)}" />
              </div>
            </label>
          </div>
        </div>
        <div class="ev-results">
          ${metricRow('Win Prob Edge', formatSignedPercent(probabilityEdge))}
          ${metricRow('Market EV', formatEv(marketEv))}
        </div>
      </div>
    `;
  };

  const moneylineCard = (side, metrics, best, inputValue) => {
    const team = side === 'home' ? prediction.homeTeam : prediction.awayTeam;
    const marketOdds = metrics.consensusOdds ?? best?.odds ?? null;
    const consensusDescriptor = best?.label ?? null;
    const probabilityEdge = metrics.probabilityEdge;
    const marketEv = metrics.marketEv;
    const placeholderOdds = (() => {
      if (marketOdds === null || marketOdds === undefined) return '';
      const formatted = formatMoneyline(marketOdds);
      return formatted === '-' ? '' : formatted;
    })();
    const rawOddsValue = inputValue;
    const oddsValue = escapeHtml(rawOddsValue);
    const oddsToggle = renderSignToggle(selectedKey, 'moneyline', side, 'odds', rawOddsValue, marketOdds);
    const fairOddsDisplay = metrics.fairOdds === null ? '-' : formatMoneyline(metrics.fairOdds);
    return `
      <div class="ev-card">
        <div class="ev-card-header">
          <span class="ev-card-team">${team}</span>
          <span class="ev-tag">Moneyline</span>
        </div>
        <div class="ev-card-details">
          ${detailRow('Market Odds', describeConsensus('', marketOdds, consensusDescriptor))}
          ${detailRow('No-Vig Win %', formatPercent(metrics.consensusProb))}
          ${detailRow('Your Win %', formatPercent(metrics.implied))}
          ${detailRow('Fair Odds (No-Vig)', fairOddsDisplay)}
        </div>
        <div class="ev-inputs">
          <label>Odds
            <div class="ev-input-wrapper">
              ${oddsToggle}
              <input type="text" inputmode="numeric" data-ev-input data-ev-type="moneyline" data-ev-side="${side}" data-ev-field="odds" data-game="${selectedKey}" value="${oddsValue}" placeholder="${escapeHtml(placeholderOdds)}" />
            </div>
          </label>
        </div>
        <div class="ev-results">
          ${metricRow('Win Prob Edge', formatSignedPercent(probabilityEdge))}
          ${metricRow('Market EV', formatEv(marketEv))}
        </div>
      </div>
    `;
  };

  const totalCard = (side, metrics, best, inputData) => {
    const label = side === 'over' ? 'Over' : 'Under';
    const marketLine = metrics.consensusLine ?? best?.line ?? null;
    const marketOdds = metrics.consensusOdds ?? best?.odds ?? null;
    const consensusDescriptor = best?.label ?? null;
    const probabilityEdge = metrics.probabilityEdge;
    const marketEv = metrics.marketEv;
    const placeholderLine = marketLine === null ? '' : Number(marketLine).toFixed(1);
    const placeholderOdds = (() => {
      if (marketOdds === null || marketOdds === undefined) return '';
      const formatted = formatMoneyline(marketOdds);
      return formatted === '-' ? '' : formatted;
    })();
    const rawLineValue = inputData.line;
    const rawOddsValue = inputData.odds;
    const lineValue = escapeHtml(rawLineValue);
    const oddsValue = escapeHtml(rawOddsValue);
    const lineToggle = renderSignToggle(selectedKey, 'total', side, 'line', rawLineValue, marketLine);
    const oddsToggle = renderSignToggle(selectedKey, 'total', side, 'odds', rawOddsValue, marketOdds);
    const fairOddsDisplay = metrics.fairOdds === null ? '-' : formatMoneyline(metrics.fairOdds);
    const lineDiff = marketLine === null || metrics.line === null ? null : metrics.line - marketLine;
    return `
      <div class="ev-card">
        <div class="ev-card-header">
          <span class="ev-card-team">${label}</span>
          <span class="ev-tag">Total</span>
        </div>
        <div class="ev-card-details">
          ${detailRow('Market Line', describeConsensus(marketLine === null ? '' : formatNumber(marketLine, 1), marketOdds, consensusDescriptor))}
          ${detailRow('No-Vig Win %', formatPercent(metrics.consensusProb))}
          ${detailRow('Your Win %', formatPercent(metrics.implied))}
          ${detailRow('Fair Odds (No-Vig)', fairOddsDisplay)}
          ${lineDiff === null ? '' : detailRow('Line vs Market', `${formatSigned(lineDiff, 1)} pts`)}
        </div>
        <div class="ev-inputs">
          <div class="ev-input-row">
            <label>Line
              <div class="ev-input-wrapper">
                ${lineToggle}
                <input type="text" inputmode="decimal" data-ev-input data-ev-type="total" data-ev-side="${side}" data-ev-field="line" data-game="${selectedKey}" value="${lineValue}" placeholder="${escapeHtml(placeholderLine)}" />
              </div>
            </label>
            <label>Odds
              <div class="ev-input-wrapper">
                ${oddsToggle}
                <input type="text" inputmode="numeric" data-ev-input data-ev-type="total" data-ev-side="${side}" data-ev-field="odds" data-game="${selectedKey}" value="${oddsValue}" placeholder="${escapeHtml(placeholderOdds)}" />
              </div>
            </label>
          </div>
        </div>
        <div class="ev-results">
          ${metricRow('Win Prob Edge', formatSignedPercent(probabilityEdge))}
          ${metricRow('Market EV', formatEv(marketEv))}
        </div>
      </div>
    `;
  };

  const content = `
    <article class="ev-game">
      <header class="ev-game-header">
        <div class="ev-matchup">
          <span class="ev-team ev-away">${prediction.awayTeam}</span>
          <span class="ev-vs">@</span>
          <span class="ev-team ev-home">${prediction.homeTeam}</span>
        </div>
        <div class="ev-game-meta">
          ${dateLabel ? `<span class="ev-meta-item ev-date">${dateLabel}</span>` : ''}
          ${moneylineConsensus.home ? `<span class="ev-meta-item">Home Win (Market): <strong>${formatPercent(moneylineConsensus.home.prob)}</strong></span>` : ''}
          ${moneylineConsensus.away ? `<span class="ev-meta-item">Away Win (Market): <strong>${formatPercent(moneylineConsensus.away.prob)}</strong></span>` : ''}
        </div>
      </header>
      <div class="ev-board">
        ${groupSection('Moneyline', [
          moneylineCard('away', mlAway, moneylineConsensus.away, inputs.moneyline.away),
          moneylineCard('home', mlHome, moneylineConsensus.home, inputs.moneyline.home),
        ])}
        ${groupSection('Spread', [
          spreadCard('away', spreadAway, spreadConsensus.away, inputs.spread.away),
          spreadCard('home', spreadHome, spreadConsensus.home, inputs.spread.home),
        ])}
        ${groupSection('Totals', [
          totalCard('over', totalOver, totalConsensus.over, inputs.total.over),
          totalCard('under', totalUnder, totalConsensus.under, inputs.total.under),
        ])}
      </div>
    </article>
  `;

  const oddsHint = state.sportsbookData.length ? '' : '<p class="hint ev-warning">Load sportsbook odds to prefill consensus numbers (optional).</p>';

  container.innerHTML = `
    ${controlsHtml}
    ${oddsHint}
    ${content}
  `;
  attachEvInputs(focusInfo);
};

const renderBestEvTab = () => {
  const container = document.getElementById('bestEvContent');
  if (!container) return;

  if (!state.predictions || !state.predictions.length) {
    container.innerHTML = '<p class="hint">Run the model to populate upcoming games.</p>';
    return;
  }

  if (!state.sportsbookData.length) {
    container.innerHTML = '<p class="hint">Load sportsbook odds in the Input tab to evaluate best bets.</p>';
    return;
  }

  if (!state.evBookSelection || state.evBookSelection === 'manual') {
    container.innerHTML = '<p class="hint">Select a sportsbook from the Input tab to use its prices.</p>';
    return;
  }

  const { weekSummaries } = buildWeekSummaries(state.predictions);
  if (!weekSummaries.length) {
    container.innerHTML = '<p class="hint">No upcoming games were found after running the model.</p>';
    return;
  }

  const availableWeekKeys = new Set(weekSummaries.map((entry) => entry.key));
  let selectedWeekKey = state.bestEvWeekFilter;
  if (!selectedWeekKey || !availableWeekKeys.has(selectedWeekKey)) {
    selectedWeekKey = weekSummaries[0].key;
    state.bestEvWeekFilter = selectedWeekKey;
  }

  const filteredPredictions = state.predictions.filter((prediction) => buildWeekKey(prediction.season, prediction.week) === selectedWeekKey);
  const bets = collectBestEvBets(filteredPredictions);
  const includeSeason = weekSummaries.length > 1;
  const weekOptionsHtml = weekSummaries.map((option) => {
    const selectedAttr = option.key === selectedWeekKey ? ' selected' : '';
    return `<option value="${escapeHtml(option.key)}"${selectedAttr}>${escapeHtml(formatWeekLabel(option.season, option.week, includeSeason))}</option>`;
  }).join('');

  const bookLabel = getSelectedBookLabel(state.evBookSelection) || state.evBookSelection;
  const controlsHtml = `
    <div class="ev-controls best-ev-controls">
      <label for="bestEvWeekSelect" class="ev-select-label">Week</label>
      <select id="bestEvWeekSelect">${weekOptionsHtml}</select>
      <span class="best-ev-book">Using <strong>${escapeHtml(bookLabel || 'Selected book')}</strong></span>
    </div>
  `;

  if (!bets.length) {
    container.innerHTML = `${controlsHtml}<p class="hint">No positive expected value bets found for this week with the selected book.</p>`;
    attachBestEvControls();
    return;
  }

  const rows = bets.map((bet) => {
    const noVigProb = formatPercent(bet.consensusProb);
    const yourProb = formatPercent(bet.impliedProb);
    const edgeDisplay = formatSignedPercent(bet.probabilityEdge);
    const evDisplay = formatEv(bet.marketEv);
    const yourOdds = formatMoneyline(bet.odds);
    const marketOdds = formatMoneyline(bet.marketOdds);
    const fairOdds = bet.fairOdds === null ? '-' : formatMoneyline(bet.fairOdds);
    const lineDelta = bet.marketLine !== null && bet.userLine !== null
      ? `${formatSigned(bet.userLine - bet.marketLine, 1)} pts`
      : '-';
    return `
      <tr>
        <td>${escapeHtml(bet.matchup)}</td>
        <td>${escapeHtml(bet.label)}</td>
        <td>${yourOdds}</td>
        <td>${marketOdds}</td>
        <td>${fairOdds}</td>
        <td>${noVigProb}</td>
        <td>${yourProb}</td>
        <td>${edgeDisplay}</td>
        <td>${evDisplay}</td>
        <td>${lineDelta}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `${controlsHtml}
    <table class="data-table best-ev-table">
      <thead>
        <tr>
          <th>Game</th>
          <th>Bet</th>
          <th>Your Odds</th>
          <th>Market Odds</th>
          <th>Fair Odds (No-Vig)</th>
          <th>No-Vig Win %</th>
          <th>Your Win %</th>
          <th>Edge</th>
          <th>EV</th>
          <th>Line Δ</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
  attachBestEvControls();
};

const attachBestEvControls = () => {
  const weekSelect = document.getElementById('bestEvWeekSelect');
  if (weekSelect) {
    weekSelect.addEventListener('change', (event) => {
      const value = event.target.value;
      if (!value) return;
      state.bestEvWeekFilter = value;
      renderBestEvTab();
    });
  }
};

const renderCustomSection = () => {
  const select = document.getElementById('customGameSelect');
  if (select) {
    const previous = select.value;
    const options = (state.predictions || []).map((prediction) => {
      const key = buildPredictionKey(prediction.homeTeam, prediction.awayTeam);
      return `<option value="${key}">${prediction.awayTeam} @ ${prediction.homeTeam}</option>`;
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

  const rows = state.customBets.map((bet, index) => {
    const prediction = state.predictionMap.get(bet.gameKey);
    if (!prediction) return '';
    const consensus = state.consensusMap.get(bet.gameKey) || null;
    let label = '';
    let modelProb = null;
    let consensusProb = null;
    let bestOdds = null;
    let bestBook = null;
    const implied = oddsToProb(bet.odds);
    let modelEdge = null;
    let modelEv = null;
    let consensusEdge = null;
    let consensusEvVal = null;

    if (bet.betType === 'home_ml' || bet.betType === 'away_ml') {
      const side = bet.betType === 'home_ml' ? 'home' : 'away';
      label = `${side === 'home' ? prediction.homeTeam : prediction.awayTeam} ML (${prediction.awayTeam} @ ${prediction.homeTeam})`;
      modelProb = side === 'home' ? prediction.homeWinProb : prediction.awayWinProb;
      const consensusNode = getConsensusMoneyline(consensus, side);
      consensusProb = consensusNode?.prob ?? null;
      bestOdds = consensusNode?.odds ?? null;
      bestBook = consensusNode?.label ?? null;
      if (implied !== null && modelProb !== null) modelEdge = modelProb - implied;
      modelEv = expectedValue(modelProb, bet.odds);
      if (implied !== null && consensusProb !== null) consensusEdge = consensusProb - implied;
      consensusEvVal = consensusProb === null ? null : expectedValue(consensusProb, bet.odds);
    } else if (bet.betType === 'home_spread' || bet.betType === 'away_spread') {
      const side = bet.betType === 'home_spread' ? 'home' : 'away';
      label = `${side === 'home' ? prediction.homeTeam : prediction.awayTeam} ${formatSpreadLine(bet.line)} (${prediction.awayTeam} @ ${prediction.homeTeam})`;
      if (bet.line !== null && Number.isFinite(bet.line)) {
        const homeCoverProb = probabilityHomeCovers(prediction, side === 'home' ? bet.line : -bet.line);
        modelProb = side === 'home' ? homeCoverProb : (homeCoverProb === null ? null : 1 - homeCoverProb);
      }
      const consensusEntry = getSpreadEntry(consensus, bet.line, side);
      consensusProb = consensusEntry?.prob ?? null;
      bestOdds = consensusEntry?.odds ?? null;
      bestBook = consensusEntry ? sampleSizeLabel(consensusEntry.sampleSize) : null;
      if (implied !== null && modelProb !== null) modelEdge = modelProb - implied;
      modelEv = modelProb === null ? null : expectedValue(modelProb, bet.odds);
      if (implied !== null && consensusProb !== null) consensusEdge = consensusProb - implied;
      consensusEvVal = consensusProb === null ? null : expectedValue(consensusProb, bet.odds);
    } else {
      const side = bet.betType; // over/under
      label = `${side === 'over' ? 'Over' : 'Under'} ${formatNumber(bet.line, 1)} (${prediction.awayTeam} @ ${prediction.homeTeam})`;
      const consensusEntry = getTotalEntry(consensus, bet.line, side);
      consensusProb = consensusEntry?.prob ?? null;
      bestOdds = consensusEntry?.odds ?? null;
      bestBook = consensusEntry ? sampleSizeLabel(consensusEntry.sampleSize) : null;
      if (implied !== null && consensusProb !== null) consensusEdge = consensusProb - implied;
      consensusEvVal = consensusProb === null ? null : expectedValue(consensusProb, bet.odds);
    }

    return `
      <tr>
        <td>${label}</td>
        <td>${formatMoneyline(bet.odds)}</td>
        <td>${formatPercent(modelProb)}</td>
        <td>${formatSignedPercent(modelEdge)}</td>
        <td>${formatEv(modelEv)}</td>
        <td>${formatPercent(consensusProb)}</td>
        <td>${formatSignedPercent(consensusEdge)}</td>
        <td>${formatEv(consensusEvVal)}</td>
        <td>${formatMoneyline(bestOdds)}${bestBook ? ` (${bestBook})` : ''}</td>
        <td><button type="button" data-remove-bet="${index}">Remove</button></td>
      </tr>
    `;
  }).join('');

  resultsContainer.innerHTML = `
    <div class="table-scroll">
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
            <th>Consensus Odds</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
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
  const container = document.getElementById('eloOutputs');
  if (!container) return;
  const ratingsHtml = renderRatingsTable(state.ratings || [], state.autoMeta);
  const predictionsHtml = renderPredictionsTable(state.predictions || []);
  container.innerHTML = `${ratingsHtml}${predictionsHtml}`;
  initInteractiveSections(container);
  attachEloFilters(container);
};

const attachEloFilters = (root) => {
  if (!root) return;
  const weekSelect = root.querySelector('#eloWeekSelect');
  if (weekSelect) {
    weekSelect.addEventListener('change', (event) => {
      const value = event.target.value;
      if (!value) return;
      state.eloWeekFilter = value;
      state.eloGameFilter = null;
      renderEloSection();
    });
  }

  const gameSelect = root.querySelector('#eloGameSelect');
  if (gameSelect) {
    gameSelect.addEventListener('change', (event) => {
      const value = event.target.value;
      state.eloGameFilter = value === '' ? null : value;
      renderEloSection();
    });
  }
};

const attachEvInputs = (focusInfo) => {
  const weekSelect = document.getElementById('evWeekSelect');
  if (weekSelect) {
    weekSelect.addEventListener('change', (event) => {
      const raw = event.target.value;
      if (raw === '') {
        state.evWeekFilter = null;
      } else {
        const parsed = Number(raw);
        state.evWeekFilter = Number.isFinite(parsed) ? parsed : null;
      }
      renderEvCalculator();
    });
  }

  const gameSelect = document.getElementById('evGameSelect');
  if (gameSelect) {
    gameSelect.addEventListener('change', (event) => {
      const { value } = event.target;
      if (state.predictionMap.has(value)) {
        state.evSelectedGame = value;
      } else {
        state.evSelectedGame = null;
      }
      renderEvCalculator();
    });
  }

  const toggleSignValue = (raw) => {
    const str = typeof raw === 'string' ? raw : String(raw ?? '');
    const trimmed = str.trim();
    if (!trimmed.length) return '-';
    if (trimmed === '-') return '';
    if (trimmed === '+') return '-';
    if (trimmed.startsWith('-')) return trimmed.slice(1);
    if (trimmed.startsWith('+')) {
      const remainder = trimmed.slice(1);
      return remainder.length ? `-${remainder}` : '-';
    }
    return `-${trimmed}`;
  };

  document.querySelectorAll('[data-ev-input]').forEach((input) => {
    input.addEventListener('input', (event) => {
      const target = event.target;
      const gameKey = target.getAttribute('data-game');
      const evType = target.getAttribute('data-ev-type');
      const side = target.getAttribute('data-ev-side');
      const field = target.getAttribute('data-ev-field');
      const caret = target.selectionStart ?? target.value.length;
      if (!gameKey || !evType || !side || !field) return;
      const inputs = getEvInput(gameKey);
      const value = target.value;
      if (evType === 'moneyline') {
        inputs.moneyline[side] = value;
      } else if (evType === 'spread') {
        const bucket = inputs.spread[side];
        if (field === 'line') bucket.line = value;
        if (field === 'odds') bucket.odds = value;
      } else if (evType === 'total') {
        const bucket = inputs.total[side];
        if (field === 'line') bucket.line = value;
        if (field === 'odds') bucket.odds = value;
      }
      trackClvForInput(gameKey, evType, side);
      renderEvCalculator({ gameKey, evType, side, field, caret });
    });
  });

  document.querySelectorAll('[data-ev-sign-toggle]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      const gameKey = button.getAttribute('data-game');
      const evType = button.getAttribute('data-ev-type');
      const side = button.getAttribute('data-ev-side');
      const field = button.getAttribute('data-ev-field');
      if (!gameKey || !evType || !side || !field) return;
      const selector = `[data-ev-input][data-game="${gameKey}"][data-ev-type="${evType}"][data-ev-side="${side}"][data-ev-field="${field}"]`;
      const input = document.querySelector(selector);
      if (!input) return;
      const toggledValue = toggleSignValue(input.value);
      input.value = toggledValue;
      const caretPos = typeof toggledValue === 'string' ? toggledValue.length : input.value.length;
      if (typeof input.focus === 'function') {
        input.focus();
      }
      if (typeof input.setSelectionRange === 'function') {
        input.setSelectionRange(caretPos, caretPos);
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });

  if (focusInfo && focusInfo.gameKey) {
    const selector = `[data-ev-input][data-game="${focusInfo.gameKey}"][data-ev-type="${focusInfo.evType}"][data-ev-side="${focusInfo.side}"][data-ev-field="${focusInfo.field}"]`;
    const input = document.querySelector(selector);
    if (input) {
      input.focus();
      const caret = typeof focusInfo.caret === 'number' ? focusInfo.caret : input.value.length;
      input.setSelectionRange(caret, caret);
    }
  }
};

const toggleSection = (header, body) => {
  const expanded = header.getAttribute('aria-expanded') === 'true';
  header.setAttribute('aria-expanded', String(!expanded));
  if (expanded) {
    body.setAttribute('hidden', '');
  } else {
    body.removeAttribute('hidden');
  }
};

const initCollapsibles = (root) => {
  root.querySelectorAll('.collapsible').forEach((section) => {
    const header = section.querySelector('.collapsible-header');
    const body = section.querySelector('.collapsible-body');
    if (!header || !body) return;
    header.addEventListener('click', (event) => {
      event.preventDefault();
      toggleSection(header, body);
    });
    header.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleSection(header, body);
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
    if (raw === '' || raw === 'null' || raw === 'undefined') return Number.NEGATIVE_INFINITY;
    const num = Number(raw);
    return Number.isNaN(num) ? Number.NEGATIVE_INFINITY : num;
  }
  return String(raw).toLowerCase();
};

const initSortableTables = (root) => {
  root.querySelectorAll('table[data-sortable="true"]').forEach((table) => {
    const headers = table.querySelectorAll('th[data-sort-key]');
    headers.forEach((th, index) => {
      const type = th.dataset.sortType || 'text';
      th.setAttribute('role', 'button');
      th.setAttribute('tabindex', '0');
      const sort = () => {
        const current = th.getAttribute('data-sort-direction');
        const next = current === 'asc' ? 'desc' : 'asc';
        headers.forEach((other) => other.removeAttribute('data-sort-direction'));
        th.setAttribute('data-sort-direction', next);
        const tbody = table.tBodies[0];
        if (!tbody) return;
        const rows = Array.from(tbody.rows);
        rows.sort((rowA, rowB) => {
          const aVal = parseSortValue(rowA.cells[index], type);
          const bVal = parseSortValue(rowB.cells[index], type);
          if (aVal === bVal) return 0;
          return aVal > bVal ? (next === 'asc' ? 1 : -1) : (next === 'asc' ? -1 : 1);
        });
        rows.forEach((row) => tbody.appendChild(row));
      };
      th.addEventListener('click', (event) => {
        event.preventDefault();
        sort();
      });
      th.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          sort();
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

const renderApiStatus = () => {
  const el = document.getElementById('apiStatus');
  if (!el) return;
  el.textContent = state.apiStatus || '';
};

const setActiveTab = (tabId) => {
  state.activeTab = tabId;
  document.querySelectorAll('.tab-button').forEach((button) => {
    const isActive = button.dataset.tab === tabId;
    button.classList.toggle('active', isActive);
  });
  document.querySelectorAll('.tab-section').forEach((section) => {
    section.classList.toggle('active', section.id === `tab-${tabId}`);
  });
};

const runModel = () => {
  const outputs = document.getElementById('eloOutputs');
  if (outputs) outputs.innerHTML = '<p class="status">Running Elo calculations…</p>';

  if (!state.games || !state.upcoming) {
    if (outputs) outputs.innerHTML = '<p class="error">Please load completed games and upcoming schedule data first.</p>';
    return;
  }

  try {
    const games = normalizeGames(state.games);
    const upcoming = normalizeUpcoming(state.upcoming);
    const market = state.market ? normalizeMarket(state.market) : [];
    if (!games.length) {
      if (outputs) outputs.innerHTML = '<p class="error">No completed games were found after parsing.</p>';
      return;
    }
    const { ratings, teams } = computeElo(games);
    let predictions = predictGames(upcoming, teams);
    predictions = mergeMarket(predictions, market);
    state.ratings = ratings;
    state.predictions = predictions;
    state.predictionMap = buildPredictionMap(predictions);
    if (state.predictions.length) {
      state.eloWeekFilter = findEarliestWeekKey(state.predictions);
      state.bestEvWeekFilter = state.eloWeekFilter;
      state.eloGameFilter = null;
      const firstKey = buildPredictionKey(state.predictions[0].homeTeam, state.predictions[0].awayTeam);
      if (!state.evSelectedGame || !state.predictionMap.has(state.evSelectedGame)) {
        state.evSelectedGame = firstKey;
      }
    } else {
      state.evSelectedGame = null;
      state.eloWeekFilter = null;
      state.eloGameFilter = null;
      state.bestEvWeekFilter = null;
    }
    applyConsensusToPredictions();

    const filteredInputs = {};
    state.predictionMap.forEach((_, key) => {
      if (state.evInputs[key]) {
        filteredInputs[key] = state.evInputs[key];
      }
    });
    state.evInputs = filteredInputs;
    if (state.evBookSelection !== 'manual') {
      applyBookPreset(state.evBookSelection, { onlyEmpty: true });
    }
    state.customBets = state.customBets.filter((bet) => state.predictionMap.has(bet.gameKey));

    renderEloSection();
    renderEvCalculator();
    renderCustomSection();
    renderBestEvTab();
  } catch (err) {
    console.error(err);
    if (outputs) outputs.innerHTML = `<p class="error">Error running model: ${err.message}</p>`;
  }
};

const getUploadMessage = (key, data, fileName) => {
  if (Array.isArray(data)) {
    return `Loaded ${data.length} rows (${fileName})`;
  }
  return `Loaded: ${fileName}`;
};

const wireFileInput = (inputId, key, parser = parseCsvFile, transform = (value) => value) => {
  const input = document.getElementById(inputId);
  if (!input) return;
  const desc = input.closest('.file-input')?.querySelector('.input-desc');
  if (desc && !desc.dataset.defaultText) desc.dataset.defaultText = desc.textContent.trim();

  input.addEventListener('change', async (event) => {
    const [file] = event.target.files;
    if (!file) {
      state[key] = null;
      if (desc && desc.dataset.defaultText) desc.textContent = desc.dataset.defaultText;
      return;
    }
    input.disabled = true;
    try {
      const raw = await parser(file);
      const data = transform(raw);
      state[key] = data;
      input.setAttribute('data-loaded', file.name);
      if (desc) desc.textContent = getUploadMessage(key, data, file.name);
    } catch (err) {
      console.error(err);
      alert(`Failed to parse ${file.name}: ${err.message}`);
      state[key] = null;
      if (desc && desc.dataset.defaultText) desc.textContent = desc.dataset.defaultText;
    } finally {
      input.disabled = false;
    }
  });
};

const handleAutoFetch = async () => {
  const seasonsInput = document.getElementById('seasonInput');
  const seasons = parseSeasonList(seasonsInput ? seasonsInput.value : '');
  if (!seasons.length) {
    setAutoStatus('Enter one or more seasons (e.g. 2018-2024) before fetching.', 'error');
    return;
  }
  setAutoStatus('Downloading schedule and results…');
  try {
    const response = await fetch(`https://r.jina.ai/http://www.habitatring.com/games.csv?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Download failed with status ${response.status}`);
    const text = await response.text();
    const marker = '\nMarkdown Content:\n';
    const idx = text.indexOf(marker);
    const csvText = (idx === -1 ? text : text.slice(idx + marker.length)).trim();
    const parsed = Papa.parse(csvText, { header: true, dynamicTyping: false, skipEmptyLines: true });
    if (parsed.errors && parsed.errors.length) {
      throw new Error(parsed.errors[0].message);
    }
    const rows = parsed.data;
    const filtered = rows.filter((row) => {
      const season = Number(row.season);
      const gameType = String(row.game_type || '').toUpperCase();
      return seasons.includes(season) && gameType !== 'PRE';
    });
    const completed = filtered.filter((row) => row.home_score !== '' && row.away_score !== '');
    const upcoming = filtered.filter((row) => row.home_score === '' || row.away_score === '');
    state.games = completed;
    state.upcoming = upcoming;
    state.market = [];
    state.autoMeta = {
      seasons,
      completedGames: completed.length,
      upcomingGames: upcoming.length,
      lastUpdated: (text.match(/Published Time:\s*(.*)/) || [])[1] || null,
    };
    setAutoStatus(`Auto data ready (${completed.length} completed, ${upcoming.length} upcoming). Click Run Model.`, 'status');
    renderEloSection();
  } catch (err) {
    console.error(err);
    state.autoMeta = null;
    setAutoStatus(err.message, 'error');
  }
};

const fetchOddsFromApi = async () => {
  if (!state.apiKey) {
    state.apiStatus = 'Enter your The Odds API key first.';
    renderApiStatus();
    return;
  }
  state.apiLoading = true;
  state.apiStatus = 'Loading sportsbook odds…';
  renderApiStatus();
  try {
    const url = new URL('https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/');
    url.searchParams.set('apiKey', state.apiKey);
    url.searchParams.set('regions', 'us');
    url.searchParams.set('markets', 'h2h,spreads,totals');
    url.searchParams.set('oddsFormat', 'american');
    url.searchParams.set('dateFormat', 'iso');
    const response = await fetch(url.toString());
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    const data = await response.json();
    state.sportsbookData = Array.isArray(data) ? data : [];
    state.consensusMap = buildConsensusMap(state.sportsbookData);
    updateBookSelectOptions();
    applyConsensusToPredictions();
    if (state.evBookSelection !== 'manual') {
      applyBookPreset(state.evBookSelection);
    }
    state.apiStatus = `Loaded odds for ${state.sportsbookData.length} games.`;
    renderEloSection();
    renderEvCalculator();
    renderCustomSection();
    renderBestEvTab();
  } catch (err) {
    console.error(err);
    state.apiStatus = `Failed to load odds: ${err.message}`;
  } finally {
    state.apiLoading = false;
    renderApiStatus();
  }
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
  const lineInput = document.getElementById('customLineInput');
  if (!gameSelect || !betTypeSelect || !oddsInput) return;
  const gameKey = gameSelect.value;
  if (!state.predictionMap.has(gameKey)) {
    alert('Select a valid game.');
    return;
  }
  const betType = betTypeSelect.value;
  const oddsRaw = oddsInput.value.trim();
  if (oddsRaw === '') {
    alert('Enter American odds (e.g. -110, +125).');
    return;
  }
  const odds = Number(oddsRaw);
  if (!Number.isFinite(odds)) {
    alert('Enter American odds (e.g. -110, +125).');
    return;
  }
  let line = null;
  const needsLine = ['home_spread', 'away_spread', 'over', 'under'].includes(betType);
  if (needsLine) {
    const lineRaw = lineInput.value.trim();
    if (lineRaw === '') {
      alert('Enter a valid point spread/total.');
      return;
    }
    line = Number(lineRaw);
    if (!Number.isFinite(line)) {
      alert('Enter a valid point spread/total.');
      return;
    }
  }
  state.customBets.push({ gameKey, betType, odds, line });
  oddsInput.value = '';
  if (lineInput) lineInput.value = '';
  renderCustomSection();
  updateCustomForm();
};

const updateCustomForm = () => {
  const selector = document.getElementById('customBetType');
  const lineWrapper = document.getElementById('customLineWrapper');
  if (!selector || !lineWrapper) return;
  const needsLine = ['home_spread', 'away_spread', 'over', 'under'].includes(selector.value);
  lineWrapper.style.display = needsLine ? 'flex' : 'none';
};

const initTabs = () => {
  document.querySelectorAll('.tab-button').forEach((button) => {
    button.addEventListener('click', () => {
      setActiveTab(button.dataset.tab);
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
  const bookSelect = document.getElementById('bookSelect');
  if (bookSelect) {
    updateBookSelectOptions();
    bookSelect.addEventListener('change', (event) => {
      const value = event.target.value;
      state.evBookSelection = value;
      if (value !== 'manual') {
        applyBookPreset(value);
      }
      renderEvCalculator();
      renderBestEvTab();
    });
  }
  document.getElementById('loadOddsBtn')?.addEventListener('click', fetchOddsFromApi);
  document.getElementById('customBetForm')?.addEventListener('submit', handleCustomBetSubmit);
  document.getElementById('customBetType')?.addEventListener('change', updateCustomForm);
  updateCustomForm();
  setAutoStatus('Awaiting auto fetch (optional).', 'status');
  renderApiStatus();
  renderBestEvTab();
};

document.addEventListener('DOMContentLoaded', init);
