
const CONFIG = {
  seedRating: 1500,
  kFactor: 20,
  regression: 0.20,
  homeFieldPoints: 1.5,
  spreadFactor: 25,
  movScale: 2.2,
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
  customBets: [],
  apiKey: '',
  apiLoading: false,
  apiStatus: null,
  activeTab: 'elo',
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

const betterOdds = (newOdds, currentOdds) => {
  if (currentOdds === null || currentOdds === undefined) return true;
  const newDecimal = americanToDecimal(newOdds);
  const currentDecimal = americanToDecimal(currentOdds);
  return newDecimal !== null && currentDecimal !== null && newDecimal > currentDecimal;
};

const normalizePoint = (point) => {
  const num = Number(point);
  if (!Number.isFinite(num)) return null;
  return num.toFixed(1);
};

const updateConsensusPair = (entry, side, outcome, bookTitle) => {
  const odds = toNumber(outcome.price);
  if (odds === null) return;
  if (!entry[side] || betterOdds(odds, entry[side].odds)) {
    entry[side] = {
      odds,
      book: bookTitle,
      prob: null,
    };
  }
};

const finalizePairProbabilities = (entry) => {
  if (!entry.home || !entry.away) return;
  const impliedHome = oddsToProb(entry.home.odds);
  const impliedAway = oddsToProb(entry.away.odds);
  if (impliedHome === null || impliedAway === null) return;
  const total = impliedHome + impliedAway;
  if (total <= 0) return;
  entry.home.prob = impliedHome / total;
  entry.away.prob = impliedAway / total;
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
      moneyline: { home: { odds: null, book: null, prob: null }, away: { odds: null, book: null, prob: null } },
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
          const odds = toNumber(outcome.price);
          if (teamCode === homeCode && odds !== null && betterOdds(odds, consensus.moneyline.home.odds)) {
            consensus.moneyline.home.odds = odds;
            consensus.moneyline.home.book = title;
          }
          if (teamCode === awayCode && odds !== null && betterOdds(odds, consensus.moneyline.away.odds)) {
            consensus.moneyline.away.odds = odds;
            consensus.moneyline.away.book = title;
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
            const entry = consensus.spreads.get(pointKey) || { pointHome: Number(homeOutcome.point), pointAway: Number(awayOutcome.point), home: null, away: null };
            updateConsensusPair(entry, 'home', homeOutcome, title);
            updateConsensusPair(entry, 'away', awayOutcome, title);
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
            const entry = consensus.totals.get(pointKey) || { point: Number(overOutcome.point), over: null, under: null };
            if (toNumber(overOutcome.price) !== null && ( !entry.over || betterOdds(toNumber(overOutcome.price), entry.over.odds) )) {
              entry.over = { odds: toNumber(overOutcome.price), book: title, prob: null };
            }
            if (toNumber(underOutcome.price) !== null && ( !entry.under || betterOdds(toNumber(underOutcome.price), entry.under.odds) )) {
              entry.under = { odds: toNumber(underOutcome.price), book: title, prob: null };
            }
            consensus.totals.set(pointKey, entry);
          }
        }
      }
    });

    if (consensus.moneyline.home.odds !== null && consensus.moneyline.away.odds !== null) {
      const impliedHome = oddsToProb(consensus.moneyline.home.odds);
      const impliedAway = oddsToProb(consensus.moneyline.away.odds);
      if (impliedHome !== null && impliedAway !== null && impliedHome + impliedAway > 0) {
        const total = impliedHome + impliedAway;
        consensus.moneyline.home.prob = impliedHome / total;
        consensus.moneyline.away.prob = impliedAway / total;
      }
    }

    consensus.spreads.forEach((entry) => finalizePairProbabilities(entry));
    consensus.totals.forEach((entry) => {
      if (entry.over && entry.under) {
        const impliedOver = oddsToProb(entry.over.odds);
        const impliedUnder = oddsToProb(entry.under.odds);
        if (impliedOver !== null && impliedUnder !== null && impliedOver + impliedUnder > 0) {
          const total = impliedOver + impliedUnder;
          entry.over.prob = impliedOver / total;
          entry.under.prob = impliedUnder / total;
        }
      }
    });

    map.set(key, consensus);
  });
  return map;
};

const getDefaultEvInput = () => ({
  selectedType: 'home_ml',
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

const EV_BET_OPTIONS = [
  { value: 'home_ml', label: 'Home Moneyline' },
  { value: 'away_ml', label: 'Away Moneyline' },
  { value: 'home_spread', label: 'Home Spread' },
  { value: 'away_spread', label: 'Away Spread' },
  { value: 'over', label: 'Total Over' },
  { value: 'under', label: 'Total Under' },
];

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

const formatMoneyline = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return value > 0 ? `+${value}` : String(value);
};

const formatEv = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return `${(value * 100).toFixed(1)}%`;
};

const formatSpreadLine = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  const num = Number(value);
  const formatted = num.toFixed(1);
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

const renderPredictionsTable = (predictions) => {
  if (!predictions || !predictions.length) {
    return '<p class="hint">Load upcoming games (CSV or auto-fetch) before running the model.</p>';
  }
  const rows = predictions.map((row) => `
      <tr>
        <td data-sort-value="${row.homeTeam}">${row.homeTeam}</td>
        <td data-sort-value="${row.awayTeam}">${row.awayTeam}</td>
        <td data-sort-value="${row.homeWinProb}">${formatPercent(row.homeWinProb)}</td>
        <td data-sort-value="${row.modelSpread}">${formatNumber(row.modelSpread, 1)}</td>
        <td data-sort-value="${row.homeFairMoneyline ?? ''}">${formatMoneyline(row.homeFairMoneyline)}</td>
        <td data-sort-value="${row.marketSpread ?? ''}">${row.marketSpread ?? '-'}</td>
        <td data-sort-value="${row.homeSpreadEdge ?? ''}">${row.homeSpreadEdge === null ? '-' : formatNumber(row.homeSpreadEdge, 1)}</td>
        <td data-sort-value="${row.homeMoneyline ?? ''}">${formatMoneyline(row.homeMoneyline)}</td>
        <td data-sort-value="${row.homeMoneylineEdge ?? ''}">${row.homeMoneylineEdge === null ? '-' : formatPercent(row.homeMoneylineEdge)}</td>
      </tr>
    `).join('');
  const explainer = '<p class="hint explanation">Home Win % maps Elo rating differences to probabilities; Model Spread divides the rating edge by 25 Elo-per-point; Fair ML is the model moneyline. Market columns appear when CSV odds are provided.</p>';
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
  const modelProb = side === 'home' ? prediction.homeWinProb : prediction.awayWinProb;
  const consensusPoint = consensus?.moneyline?.[side] || null;
  const consensusProb = consensusPoint?.prob ?? null;
  const consensusOdds = consensusPoint?.odds ?? null;
  const implied = validOdds === null ? null : oddsToProb(validOdds);
  return {
    odds: validOdds,
    implied,
    modelProb,
    consensusProb,
    modelEv: validOdds === null || modelProb === null ? null : expectedValue(modelProb, validOdds),
    consensusEv: validOdds === null || consensusProb === null ? null : expectedValue(consensusProb, validOdds),
    bestOdds: consensusOdds,
    bestBook: consensusPoint?.book || null,
  };
};

const getSpreadEntry = (consensus, line, side) => {
  if (!consensus || !consensus.spreads || line === null || line === '') return null;
  const pointKey = normalizePoint(side === 'home' ? line : -line);
  if (pointKey === null) return null;
  const entry = consensus.spreads.get(pointKey);
  if (!entry) return null;
  return side === 'home' ? entry.home && { ...entry.home, point: entry.pointHome } : entry.away && { ...entry.away, point: entry.pointAway };
};

const createSpreadMetrics = (prediction, consensus, inputs, side) => {
  const data = inputs.spread[side];
  const rawLine = data.line;
  const rawOdds = data.odds;
  const line = rawLine === '' ? null : Number(rawLine);
  const odds = rawOdds === '' ? null : Number(rawOdds);
  const validLine = Number.isFinite(line) ? line : null;
  const validOdds = Number.isFinite(odds) ? odds : null;
  const homeCoverProb = validLine === null ? null : probabilityHomeCovers(prediction, side === 'home' ? validLine : -validLine);
  const modelProb = validLine === null ? null : (side === 'home' ? homeCoverProb : (homeCoverProb === null ? null : 1 - homeCoverProb));
  const consensusEntry = getSpreadEntry(consensus, validLine, side);
  const consensusProb = consensusEntry?.prob ?? null;
  const implied = validOdds === null ? null : oddsToProb(validOdds);
  return {
    line: validLine,
    odds: validOdds,
    implied,
    modelProb,
    consensusProb,
    modelEv: validOdds === null || modelProb === null ? null : expectedValue(modelProb, validOdds),
    consensusEv: validOdds === null || consensusProb === null ? null : expectedValue(consensusProb, validOdds),
    bestOdds: consensusEntry?.odds ?? null,
    bestBook: consensusEntry?.book ?? null,
    modelEdgePoints: validLine === null ? null : (side === 'home' ? prediction.modelSpread - validLine : validLine + prediction.modelSpread),
  };
};

const getTotalEntry = (consensus, line, side) => {
  if (!consensus || !consensus.totals || line === null || line === '') return null;
  const pointKey = normalizePoint(line);
  if (pointKey === null) return null;
  const entry = consensus.totals.get(pointKey);
  if (!entry) return null;
  return side === 'over' ? entry.over : entry.under;
};

const findBestSpread = (consensus, side) => {
  if (!consensus || !consensus.spreads) return null;
  let best = null;
  consensus.spreads.forEach((entry) => {
    const outcome = side === 'home' ? entry.home : entry.away;
    if (!outcome || outcome.odds === null || outcome.odds === undefined) return;
    const decimal = americanToDecimal(outcome.odds);
    if (decimal === null) return;
    if (!best || decimal > best.decimal) {
      best = {
        line: side === 'home' ? entry.pointHome : entry.pointAway,
        odds: outcome.odds,
        book: outcome.book || null,
        decimal,
      };
    }
  });
  if (best) delete best.decimal;
  return best;
};

const findBestTotal = (consensus, side) => {
  if (!consensus || !consensus.totals) return null;
  let best = null;
  consensus.totals.forEach((entry) => {
    const outcome = side === 'over' ? entry.over : entry.under;
    if (!outcome || outcome.odds === null || outcome.odds === undefined) return;
    const decimal = americanToDecimal(outcome.odds);
    if (decimal === null) return;
    if (!best || decimal > best.decimal) {
      best = {
        line: entry.point,
        odds: outcome.odds,
        book: outcome.book || null,
        decimal,
      };
    }
  });
  if (best) delete best.decimal;
  return best;
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
  return {
    line: validLine,
    odds: validOdds,
    implied,
    consensusProb,
    consensusEv: validOdds === null || consensusProb === null ? null : expectedValue(consensusProb, validOdds),
    bestOdds: consensusEntry?.odds ?? null,
    bestBook: consensusEntry?.book ?? null,
  };
};

const renderEvCalculator = (focusInfo) => {
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

  const sections = state.predictions.map((prediction) => {
    const key = buildPredictionKey(prediction.homeTeam, prediction.awayTeam);
    const consensus = state.consensusMap.get(key) || null;
    const inputs = getEvInput(key);
    if (!inputs.selectedType) inputs.selectedType = 'home_ml';
    const selectedType = inputs.selectedType;

    const moneylineMetrics = {
      home: createMoneylineMetrics(prediction, consensus, inputs, 'home'),
      away: createMoneylineMetrics(prediction, consensus, inputs, 'away'),
    };
    const spreadMetrics = {
      home: createSpreadMetrics(prediction, consensus, inputs, 'home'),
      away: createSpreadMetrics(prediction, consensus, inputs, 'away'),
    };
    const totalMetrics = {
      over: createTotalMetrics(consensus, inputs, 'over'),
      under: createTotalMetrics(consensus, inputs, 'under'),
    };

    const bestSpread = {
      home: findBestSpread(consensus, 'home'),
      away: findBestSpread(consensus, 'away'),
    };
    const bestTotal = {
      over: findBestTotal(consensus, 'over'),
      under: findBestTotal(consensus, 'under'),
    };

    const bestMoneyline = {
      home: consensus?.moneyline?.home || null,
      away: consensus?.moneyline?.away || null,
    };

    const dateLabel = prediction.date ? new Date(prediction.date).toISOString().slice(0, 10) : '';

    let summaryText = '';
    let inputFields = '';

    const optionLabel = (value, label) => `<option value="${value}" ${selectedType === value ? 'selected' : ''}>${label}</option>`;

    switch (selectedType) {
      case 'home_ml': {
        const metrics = moneylineMetrics.home;
        const best = bestMoneyline.home;
        summaryText = best && best.odds !== null
          ? `Consensus odds: ${formatMoneyline(best.odds)}${best.book ? ` (${best.book})` : ''}`
          : 'Consensus odds unavailable for the home moneyline.';
        inputFields = `
          <label>Your Odds
            <input type="number" step="1" data-ev-input data-ev-type="moneyline" data-ev-side="home" data-ev-field="odds" data-game="${key}" value="${inputs.moneyline.home}" placeholder="-110" />
          </label>
          <p class="ev-results">Model EV: ${formatEv(metrics.modelEv)} · Market EV: ${formatEv(metrics.consensusEv)}</p>
        `;
        break;
      }
      case 'away_ml': {
        const metrics = moneylineMetrics.away;
        const best = bestMoneyline.away;
        summaryText = best && best.odds !== null
          ? `Consensus odds: ${formatMoneyline(best.odds)}${best.book ? ` (${best.book})` : ''}`
          : 'Consensus odds unavailable for the away moneyline.';
        inputFields = `
          <label>Your Odds
            <input type="number" step="1" data-ev-input data-ev-type="moneyline" data-ev-side="away" data-ev-field="odds" data-game="${key}" value="${inputs.moneyline.away}" placeholder="+120" />
          </label>
          <p class="ev-results">Model EV: ${formatEv(metrics.modelEv)} · Market EV: ${formatEv(metrics.consensusEv)}</p>
        `;
        break;
      }
      case 'home_spread': {
        const metrics = spreadMetrics.home;
        const best = bestSpread.home;
        summaryText = best
          ? `Consensus line: ${formatSpreadLine(best.line)} @ ${formatMoneyline(best.odds)}${best.book ? ` (${best.book})` : ''}`
          : 'Consensus spread unavailable for the home side.';
        inputFields = `
          <label>Line / Odds
            <div class="dual-input">
              <input type="number" step="0.5" data-ev-input data-ev-type="spread" data-ev-side="home" data-ev-field="line" data-game="${key}" value="${inputs.spread.home.line}" placeholder="-3.5" />
              <input type="number" step="1" data-ev-input data-ev-type="spread" data-ev-side="home" data-ev-field="odds" data-game="${key}" value="${inputs.spread.home.odds}" placeholder="-110" />
            </div>
          </label>
          <p class="ev-results">Model Edge: ${metrics.modelEdgePoints === null ? '-' : formatNumber(metrics.modelEdgePoints, 1)} pts · Model EV: ${formatEv(metrics.modelEv)} · Market EV: ${formatEv(metrics.consensusEv)}</p>
        `;
        break;
      }
      case 'away_spread': {
        const metrics = spreadMetrics.away;
        const best = bestSpread.away;
        summaryText = best
          ? `Consensus line: ${formatSpreadLine(best.line)} @ ${formatMoneyline(best.odds)}${best.book ? ` (${best.book})` : ''}`
          : 'Consensus spread unavailable for the away side.';
        inputFields = `
          <label>Line / Odds
            <div class="dual-input">
              <input type="number" step="0.5" data-ev-input data-ev-type="spread" data-ev-side="away" data-ev-field="line" data-game="${key}" value="${inputs.spread.away.line}" placeholder="+3.5" />
              <input type="number" step="1" data-ev-input data-ev-type="spread" data-ev-side="away" data-ev-field="odds" data-game="${key}" value="${inputs.spread.away.odds}" placeholder="-110" />
            </div>
          </label>
          <p class="ev-results">Model Edge: ${metrics.modelEdgePoints === null ? '-' : formatNumber(metrics.modelEdgePoints, 1)} pts · Model EV: ${formatEv(metrics.modelEv)} · Market EV: ${formatEv(metrics.consensusEv)}</p>
        `;
        break;
      }
      case 'over': {
        const metrics = totalMetrics.over;
        const best = bestTotal.over;
        summaryText = best
          ? `Consensus total: ${formatNumber(best.line, 1)} (Over) @ ${formatMoneyline(best.odds)}${best.book ? ` (${best.book})` : ''}`
          : 'Consensus total unavailable for the over.';
        inputFields = `
          <label>Total / Odds
            <div class="dual-input">
              <input type="number" step="0.5" data-ev-input data-ev-type="total" data-ev-side="over" data-ev-field="line" data-game="${key}" value="${inputs.total.over.line}" placeholder="45.5" />
              <input type="number" step="1" data-ev-input data-ev-type="total" data-ev-side="over" data-ev-field="odds" data-game="${key}" value="${inputs.total.over.odds}" placeholder="-110" />
            </div>
          </label>
          <p class="ev-results">Market EV: ${formatEv(metrics.consensusEv)}</p>
        `;
        break;
      }
      case 'under':
      default: {
        const metrics = totalMetrics.under;
        const best = bestTotal.under;
        summaryText = best
          ? `Consensus total: ${formatNumber(best.line, 1)} (Under) @ ${formatMoneyline(best.odds)}${best.book ? ` (${best.book})` : ''}`
          : 'Consensus total unavailable for the under.';
        inputFields = `
          <label>Total / Odds
            <div class="dual-input">
              <input type="number" step="0.5" data-ev-input data-ev-type="total" data-ev-side="under" data-ev-field="line" data-game="${key}" value="${inputs.total.under.line}" placeholder="45.5" />
              <input type="number" step="1" data-ev-input data-ev-type="total" data-ev-side="under" data-ev-field="odds" data-game="${key}" value="${inputs.total.under.odds}" placeholder="-110" />
            </div>
          </label>
          <p class="ev-results">Market EV: ${formatEv(metrics.consensusEv)}</p>
        `;
        break;
      }
    }

    const betOptions = EV_BET_OPTIONS.map((option) => optionLabel(option.value, option.label)).join('');

    return `
      <article class="ev-game">
        <header>
          <h3>${prediction.awayTeam} @ ${prediction.homeTeam}${dateLabel ? ` · ${dateLabel}` : ''}</h3>
        </header>
        <div class="ev-body">
          <div class="ev-metrics">
            <p><strong>Model Spread:</strong> ${formatSpreadLine(prediction.modelSpread)}</p>
            <p><strong>Model Fair ML:</strong> ${formatMoneyline(prediction.homeFairMoneyline)}</p>
            <p><strong>Best Home ML:</strong> ${formatMoneyline(bestMoneyline.home?.odds ?? null)}${bestMoneyline.home?.book ? ` (${bestMoneyline.home.book})` : ''}</p>
            <p><strong>Best Away ML:</strong> ${formatMoneyline(bestMoneyline.away?.odds ?? null)}${bestMoneyline.away?.book ? ` (${bestMoneyline.away.book})` : ''}</p>
            <p><strong>Best Home Spread:</strong> ${bestSpread.home ? `${formatSpreadLine(bestSpread.home.line)} @ ${formatMoneyline(bestSpread.home.odds)}${bestSpread.home.book ? ` (${bestSpread.home.book})` : ''}` : '-'}</p>
            <p><strong>Best Away Spread:</strong> ${bestSpread.away ? `${formatSpreadLine(bestSpread.away.line)} @ ${formatMoneyline(bestSpread.away.odds)}${bestSpread.away.book ? ` (${bestSpread.away.book})` : ''}` : '-'}</p>
            <p><strong>Best Total Over:</strong> ${bestTotal.over ? `${formatNumber(bestTotal.over.line, 1)} @ ${formatMoneyline(bestTotal.over.odds)}${bestTotal.over.book ? ` (${bestTotal.over.book})` : ''}` : '-'}</p>
            <p><strong>Best Total Under:</strong> ${bestTotal.under ? `${formatNumber(bestTotal.under.line, 1)} @ ${formatMoneyline(bestTotal.under.odds)}${bestTotal.under.book ? ` (${bestTotal.under.book})` : ''}` : '-'}</p>
          </div>
          <div class="ev-inputs">
            <label>Bet Type
              <select data-ev-select data-game="${key}">
                ${betOptions}
              </select>
            </label>
            <p class="ev-summary">${summaryText}</p>
            ${inputFields}
          </div>
        </div>
      </article>
    `;
  }).join('');

  container.innerHTML = sections;
  attachEvControls(focusInfo);
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
      const consensusNode = consensus?.moneyline?.[side] || null;
      consensusProb = consensusNode?.prob ?? null;
      bestOdds = consensusNode?.odds ?? null;
      bestBook = consensusNode?.book ?? null;
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
      bestBook = consensusEntry?.book ?? null;
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
      bestBook = consensusEntry?.book ?? null;
      if (implied !== null && consensusProb !== null) consensusEdge = consensusProb - implied;
      consensusEvVal = consensusProb === null ? null : expectedValue(consensusProb, bet.odds);
    }

    return `
      <tr>
        <td>${label}</td>
        <td>${formatMoneyline(bet.odds)}</td>
        <td>${formatPercent(modelProb)}</td>
        <td>${formatPercent(modelEdge)}</td>
        <td>${formatEv(modelEv)}</td>
        <td>${formatPercent(consensusProb)}</td>
        <td>${formatPercent(consensusEdge)}</td>
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
            <th>Best Market Odds</th>
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
};

const attachEvControls = (focusInfo) => {
  document.querySelectorAll('[data-ev-select]').forEach((select) => {
    select.addEventListener('change', (event) => {
      const gameKey = event.target.getAttribute('data-game');
      if (!gameKey) return;
      const inputs = getEvInput(gameKey);
      inputs.selectedType = event.target.value;
      renderEvCalculator();
    });
  });

  document.querySelectorAll('[data-ev-input]').forEach((input) => {
    input.addEventListener('input', (event) => {
      const target = event.target;
      const gameKey = target.getAttribute('data-game');
      const evType = target.getAttribute('data-ev-type');
      const side = target.getAttribute('data-ev-side');
      const field = target.getAttribute('data-ev-field');
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
      renderEvCalculator({ gameKey, evType, side, field, caret: value.length });
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
    state.apiStatus = `Loaded odds for ${state.sportsbookData.length} games.`;
    renderEvCalculator();
    renderCustomSection();
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
  document.getElementById('loadOddsBtn')?.addEventListener('click', fetchOddsFromApi);
  document.getElementById('customBetForm')?.addEventListener('submit', handleCustomBetSubmit);
  document.getElementById('customBetType')?.addEventListener('change', updateCustomForm);
  updateCustomForm();
  setAutoStatus('Awaiting auto fetch (optional).', 'status');
  renderApiStatus();
};

document.addEventListener('DOMContentLoaded', init);
