const state = {
  games: null,
  upcoming: null,
  market: null,
  autoMeta: null,
};

const DEFAULT_CONFIG = {
  baseRating: 1500,
  kFactor: 20,
  regression: 0.25,
  homeFieldAdv: 55,
  spreadFactor: 25,
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
      const year = Number(part);
      if (Number.isFinite(year)) seasons.add(year);
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

const parseCsvString = (csvText) => {
  const parsed = Papa.parse(csvText, {
    header: true,
    dynamicTyping: false,
    skipEmptyLines: true,
  });
  if (parsed.errors && parsed.errors.length) {
    const sample = parsed.errors[0];
    throw new Error(`CSV parse error at row ${sample.row}: ${sample.message}`);
  }
  return parsed.data;
};

const setAutoStatus = (message, variant = 'status') => {
  const el = document.getElementById('autoStatus');
  if (!el) return;
  el.textContent = message;
  el.className = `hint ${variant}`;
};

const setFileInputBadge = (inputId, message) => {
  const input = document.getElementById(inputId);
  const label = input ? input.closest('.file-input') : null;
  const desc = label ? label.querySelector('.input-desc') : null;
  if (desc) {
    if (!desc.dataset.defaultText) {
      desc.dataset.defaultText = desc.textContent.trim();
    }
    desc.textContent = message || desc.dataset.defaultText || '';
  }
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
    const season = toNumber(firstExisting(row, ['season', 'schedule_season', 'game_season']));
    const week = toNumber(firstExisting(row, ['week', 'schedule_week', 'game_week']));
    const homeTeam = firstExisting(row, ['home_team', 'team_home', 'team_home_abbr']);
    const awayTeam = firstExisting(row, ['away_team', 'team_away', 'team_away_abbr']);
    const homeScore = toNumber(firstExisting(row, ['home_score', 'score_home', 'team_home_score', 'home_score_total']));
    const awayScore = toNumber(firstExisting(row, ['away_score', 'score_away', 'team_away_score', 'away_score_total']));
    const neutralRaw = firstExisting(row, ['neutral_site', 'neutral', 'schedule_neutral_site', 'stadium_neutral']);
    const location = row.location;
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

    const date = dateRaw ? new Date(dateRaw) : null;
    games.push({
      season,
      week,
      date,
      homeTeam: String(homeTeam).trim(),
      awayTeam: String(awayTeam).trim(),
      homeScore,
      awayScore,
      neutral: neutralRaw !== undefined ? toBool(neutralRaw) : String(location || '').toLowerCase() === 'neutral',
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
      date: dateRaw ? new Date(dateRaw) : null,
      homeTeam: String(homeTeam).trim(),
      awayTeam: String(awayTeam).trim(),
      neutral: toBool(firstExisting(row, ['neutral_site', 'neutral', 'schedule_neutral_site'])) || String(row.location || '').toLowerCase() === 'neutral',
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
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return Number(value).toFixed(digits);
};

const formatMoneyline = (value) => {
  if (value === null || value === undefined) return '-';
  return value > 0 ? `+${value}` : String(value);
};

const formatPercent = (value) => {
  if (value === null || value === undefined) return '-';
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
              <th data-sort-key="rank" data-sort-type="number">#</th>
              <th data-sort-key="team" data-sort-type="text">Team</th>
              <th data-sort-key="rating" data-sort-type="number">Rating</th>
              <th data-sort-key="games" data-sort-type="number">Games</th>
              <th data-sort-key="last" data-sort-type="number">Last Game</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="5">No ratings computed.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;
};


const renderPredictionsTable = (predictions) => {
  const rows = predictions
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
  return `
    <section class="collapsible" data-section="predictions">
      <div class="collapsible-header" role="button" tabindex="0" aria-expanded="true">Upcoming Games</div>
      <div class="collapsible-body">
        <table class="data-table" data-sortable="true">
          <thead>
            <tr>
              <th data-sort-key="home" data-sort-type="text">Home</th>
              <th data-sort-key="away" data-sort-type="text">Away</th>
              <th data-sort-key="prob" data-sort-type="number">Home Win %</th>
              <th data-sort-key="spread" data-sort-type="number">Model Spread</th>
              <th data-sort-key="fairml" data-sort-type="number">Fair ML</th>
              <th data-sort-key="marketspread" data-sort-type="number">Market Spread</th>
              <th data-sort-key="spreadedge" data-sort-type="number">Spread Edge</th>
              <th data-sort-key="ml" data-sort-type="number">Home ML</th>
              <th data-sort-key="mledge" data-sort-type="number">ML Edge</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="9">No upcoming games provided.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;
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

const runModel = async () => {
  const outputs = document.getElementById('outputs');
  outputs.innerHTML = '<p class="status">Running Elo calculations…</p>';

  if (!state.games || !state.upcoming) {
    outputs.innerHTML = '<p class="error">Please provide games and upcoming schedule data (upload or auto-fetch).</p>';
    return;
  }

  try {
    const games = normalizeGames(state.games);
    const upcoming = normalizeUpcoming(state.upcoming);
    const market = state.market ? normalizeMarket(state.market) : [];

    if (!games.length) {
      outputs.innerHTML = '<p class="error">No completed games found after filtering (season mismatch?).</p>';
      return;
    }

    const { ratings, teams } = computeElo(games, DEFAULT_CONFIG);
    const predictions = mergeMarket(predictGames(upcoming, teams, DEFAULT_CONFIG), market);

    outputs.innerHTML = `
      ${renderRatingsTable(ratings, state.autoMeta)}
      ${renderPredictionsTable(predictions)}
    `;
    initInteractiveSections(outputs);
  } catch (err) {
    console.error(err);
    outputs.innerHTML = `<p class="error">Error running model: ${err.message}</p>`;
  }
};

const wireFileInput = (inputId, key) => {
  const input = document.getElementById(inputId);
  const label = input.closest('.file-input');
  const desc = label ? label.querySelector('.input-desc') : null;
  if (desc && !desc.dataset.defaultText) {
    desc.dataset.defaultText = desc.textContent.trim();
  }

  input.addEventListener('change', async (event) => {
    const [file] = event.target.files;
    state.autoMeta = null;
    setAutoStatus('Awaiting auto fetch (optional).', 'status');
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
      input.setAttribute('data-loaded', file.name);
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

const fetchAutoData = async () => {
  const seasonsInput = document.getElementById('seasonInput');
  const seasons = parseSeasonList(seasonsInput.value);
  if (!seasons.length) {
    throw new Error('Enter at least one season (e.g., 2010-2024).');
  }

  const response = await fetch(`${HABITATRING_PROXY_URL}?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to download games CSV (status ${response.status}).`);
  }
  const rawText = await response.text();
  const lastUpdated = extractPublishedTime(rawText);
  const csvText = stripProxyEnvelope(rawText);
  const rows = parseCsvString(csvText);

  const seasonSet = new Set(seasons);
  const filtered = rows.filter((row) => {
    const seasonVal = Number(row.season);
    if (!Number.isFinite(seasonVal) || !seasonSet.has(seasonVal)) return false;
    const gameType = (row.game_type || '').toUpperCase();
    return gameType !== 'PRE';
  });

  if (!filtered.length) {
    throw new Error('No games found for requested seasons.');
  }

  const completed = filtered.filter((row) => row.home_score !== '' && row.away_score !== '');
  const upcoming = filtered.filter((row) => row.home_score === '' || row.away_score === '');

  completed.forEach((row) => {
    if (!('neutral_site' in row)) {
      row.neutral_site = String(row.location || '').toLowerCase() === 'neutral';
    }
  });
  upcoming.forEach((row) => {
    if (!('neutral_site' in row)) {
      row.neutral_site = String(row.location || '').toLowerCase() === 'neutral';
    }
  });

  state.games = completed;
  state.upcoming = upcoming;
  state.market = upcoming;
  state.autoMeta = {
    seasons,
    lastUpdated,
    completedGames: completed.length,
    upcomingGames: upcoming.length,
  };

  setFileInputBadge('gamesFile', `Auto-loaded ${completed.length} games`);
  setFileInputBadge('upcomingFile', `Auto-loaded ${upcoming.length} fixtures`);
  setFileInputBadge('marketFile', 'Market data derived from nflverse lines');
};

const handleAutoFetch = async () => {
  try {
    setAutoStatus('Downloading schedule and results…');
    await fetchAutoData();
    const { completedGames, upcomingGames } = state.autoMeta || {};
    setAutoStatus(`Auto data ready (${completedGames ?? 0} completed, ${upcomingGames ?? 0} upcoming). Click Run Model.`, 'status');
    runModel();
  } catch (err) {
    console.error(err);
    state.autoMeta = null;
    setAutoStatus(err.message, 'error');
  }
};

const init = () => {
  wireFileInput('gamesFile', 'games');
  wireFileInput('upcomingFile', 'upcoming');
  wireFileInput('marketFile', 'market');
  document.getElementById('runBtn').addEventListener('click', runModel);
  document.getElementById('autoFetchBtn').addEventListener('click', handleAutoFetch);
  setAutoStatus('Awaiting auto fetch (optional).', 'status');
};

document.addEventListener('DOMContentLoaded', init);
