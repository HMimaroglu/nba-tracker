require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const API_KEY = process.env.BALLDONTLIE_API_KEY;
const ODDS_API_KEY = process.env.ODDS_API_KEY;

// Store odds history by quarter for each game time slot
// Structure: { "2024-11-29T17:00": { quarter: 2, odds: [...], lastFetch: timestamp } }
const oddsHistory = new Map();

// Cache for current odds - only updated when quarter changes
let cachedOdds = null;
let cachedOddsTimestamp = null;

// Track game states for synchronized quarter-based API calls
// Structure: { "2024-11-29T17:00": { games: [...], lowestQuarter: 1 } }
const gameTimeSlots = new Map();

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Get today's date in YYYY-MM-DD format
function getTodayDate() {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

// Parse ISO 8601 duration (PT05M09.00S) to readable format (5:09)
function parseGameClock(isoDuration) {
  if (!isoDuration) return '';
  // Match PT followed by optional minutes and seconds
  const match = isoDuration.match(/PT(\d+)M([\d.]+)S/);
  if (match) {
    const minutes = parseInt(match[1]);
    const seconds = Math.floor(parseFloat(match[2]));
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
  return isoDuration;
}

// Fetch live scores from NBA CDN (real-time during games)
async function fetchNBALiveScores() {
  try {
    const response = await fetch('https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json');
    if (!response.ok) return null;
    const data = await response.json();
    return data.scoreboard?.games || [];
  } catch (error) {
    console.error('NBA CDN fetch error:', error);
    return null;
  }
}

// Fetch schedule from balldontlie (for game info when NBA CDN is empty)
async function fetchBallDontLieGames(date) {
  if (!API_KEY) return null;
  try {
    const response = await fetch(
      `https://api.balldontlie.io/v1/games?dates[]=${date}`,
      { headers: { 'Authorization': API_KEY } }
    );
    if (!response.ok) return null;
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('BallDontLie fetch error:', error);
    return null;
  }
}

// Fetch live odds from The Odds API
let lastOddsError = null;

async function fetchOdds() {
  if (!ODDS_API_KEY) {
    console.log('Odds API: No API key configured');
    return null;
  }
  try {
    const response = await fetch(
      `https://api.the-odds-api.com/v4/sports/basketball_nba/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=spreads,totals,h2h&oddsFormat=american`
    );
    if (!response.ok) {
      const text = await response.text();
      try {
        const errorData = JSON.parse(text);
        if (errorData.error_code === 'OUT_OF_USAGE_CREDITS') {
          lastOddsError = 'quota_exceeded';
          console.error('Odds API: Quota exceeded');
        } else {
          lastOddsError = 'api_error';
          console.error('Odds API error:', response.status, errorData.message || response.statusText);
        }
      } catch {
        lastOddsError = 'api_error';
        console.error('Odds API error:', response.status, response.statusText);
      }
      return null;
    }
    lastOddsError = null;
    const data = await response.json();
    console.log('Odds API: Fetched', data?.length || 0, 'games');
    return data;
  } catch (error) {
    console.error('Odds API fetch error:', error);
    lastOddsError = 'fetch_error';
    return null;
  }
}

// Round start time to nearest hour for grouping games
function getTimeSlotKey(datetime) {
  const date = new Date(datetime);
  date.setMinutes(0, 0, 0);
  return date.toISOString();
}

// Get quarter number from game status (0 = not started, 5 = final/OT)
function getQuarterNumber(game) {
  const status = game.status;
  if (status === 'Final') return 5;
  if (status === 'Scheduled') return 0;
  if (status === 'Half' || status === 'Halftime') return 2;
  const match = status.match(/Q(\d)/);
  if (match) return parseInt(match[1]);
  if (status.includes('OT')) return 5;
  return 0;
}

// Update game time slots and check if we should fetch odds
function updateGameSlots(games) {
  const slots = new Map();

  games.forEach(game => {
    const slotKey = getTimeSlotKey(game.datetime);
    if (!slots.has(slotKey)) {
      slots.set(slotKey, { games: [], quarters: [] });
    }
    const slot = slots.get(slotKey);
    const quarter = getQuarterNumber(game);
    slot.games.push({
      id: game.id,
      home: game.home_team.abbreviation,
      away: game.visitor_team.abbreviation,
      quarter: quarter,
      status: game.status
    });
    slot.quarters.push(quarter);
  });

  // Calculate the minimum quarter for each slot (only considering started games)
  slots.forEach((slot, key) => {
    const startedQuarters = slot.quarters.filter(q => q > 0);
    slot.lowestQuarter = startedQuarters.length > 0 ? Math.min(...startedQuarters) : 0;
    slot.allStarted = slot.quarters.every(q => q > 0);
  });

  return slots;
}

// Check if odds should be fetched for a time slot
function shouldFetchOdds(slotKey, currentLowestQuarter) {
  const history = oddsHistory.get(slotKey);

  // No history = first fetch when games start
  if (!history && currentLowestQuarter > 0) return true;

  // Fetch when all games have progressed to a new quarter
  if (history && currentLowestQuarter > history.quarter) return true;

  return false;
}

// API endpoint to fetch NBA scores
app.get('/api/scores', async (req, res) => {
  try {
    // First try NBA CDN for live scores
    const nbaGames = await fetchNBALiveScores();

    if (nbaGames && nbaGames.length > 0) {
      // Transform NBA CDN format to our format
      const games = nbaGames.map(game => {
        const clockTime = parseGameClock(game.gameClock);
        return {
        id: game.gameId,
        status: game.gameStatus === 1 ? 'Scheduled' :
                game.gameStatus === 2 ? `Q${game.period}` :
                'Final',
        period: game.period,
        time: clockTime,
        datetime: game.gameTimeUTC,
        home_team_score: game.homeTeam.score,
        visitor_team_score: game.awayTeam.score,
        home_team: {
          id: game.homeTeam.teamId,
          full_name: `${game.homeTeam.teamCity} ${game.homeTeam.teamName}`,
          city: game.homeTeam.teamCity,
          abbreviation: game.homeTeam.teamTricode
        },
        visitor_team: {
          id: game.awayTeam.teamId,
          full_name: `${game.awayTeam.teamCity} ${game.awayTeam.teamName}`,
          city: game.awayTeam.teamCity,
          abbreviation: game.awayTeam.teamTricode
        }
      };
      });

      return res.json({ date: getTodayDate(), games, source: 'nba' });
    }

    // Fall back to balldontlie for schedule
    if (!API_KEY) {
      return res.status(500).json({
        error: 'API key not configured',
        message: 'Please set BALLDONTLIE_API_KEY environment variable'
      });
    }

    const today = getTodayDate();
    const bdlGames = await fetchBallDontLieGames(today);

    if (bdlGames) {
      return res.json({ date: today, games: bdlGames, source: 'balldontlie' });
    }

    res.json({ date: today, games: [], source: 'none' });

  } catch (error) {
    console.error('Error fetching NBA scores:', error);
    res.status(500).json({ error: 'Failed to fetch NBA scores' });
  }
});

// API endpoint to check status
app.get('/api/status', (req, res) => {
  res.json({
    configured: !!API_KEY,
    oddsConfigured: !!ODDS_API_KEY,
    date: getTodayDate()
  });
});

// API endpoint to get odds with quarter-synchronized fetching
app.get('/api/odds', async (req, res) => {
  try {
    if (!ODDS_API_KEY) {
      return res.status(500).json({
        error: 'Odds API key not configured',
        message: 'Please set ODDS_API_KEY environment variable'
      });
    }

    // First get current game states
    const nbaGames = await fetchNBALiveScores();
    let games = [];

    if (nbaGames && nbaGames.length > 0) {
      games = nbaGames.map(game => {
        const clockTime = parseGameClock(game.gameClock);
        return {
          id: game.gameId,
          status: game.gameStatus === 1 ? 'Scheduled' :
                  game.gameStatus === 2 ? `Q${game.period}` :
                  'Final',
          period: game.period,
          time: clockTime,
          datetime: game.gameTimeUTC,
          home_team_score: game.homeTeam.score,
          visitor_team_score: game.awayTeam.score,
          home_team: {
            abbreviation: game.homeTeam.teamTricode,
            full_name: `${game.homeTeam.teamCity} ${game.homeTeam.teamName}`
          },
          visitor_team: {
            abbreviation: game.awayTeam.teamTricode,
            full_name: `${game.awayTeam.teamCity} ${game.awayTeam.teamName}`
          }
        };
      });
    }

    // Group games by start time and determine quarter status
    const slots = updateGameSlots(games);
    const fetchResults = [];
    let newOddsFetched = false;

    // Check each time slot to see if we need to fetch odds (ONLY on quarter change)
    for (const [slotKey, slot] of slots) {
      // Only consider slots where all games have started
      if (slot.allStarted && shouldFetchOdds(slotKey, slot.lowestQuarter)) {
        console.log(`Quarter changed! Fetching odds for slot ${slotKey} at quarter ${slot.lowestQuarter}`);
        const odds = await fetchOdds();

        if (odds) {
          // Update the cache
          cachedOdds = odds;
          cachedOddsTimestamp = Date.now();

          // Store in history
          if (!oddsHistory.has(slotKey)) {
            oddsHistory.set(slotKey, { history: [] });
          }
          const slotHistory = oddsHistory.get(slotKey);
          slotHistory.quarter = slot.lowestQuarter;
          slotHistory.history.push({
            quarter: slot.lowestQuarter,
            timestamp: new Date().toISOString(),
            odds: odds
          });
          slotHistory.lastFetch = Date.now();
          newOddsFetched = true;

          fetchResults.push({
            slotKey,
            quarter: slot.lowestQuarter,
            gamesInSlot: slot.games.map(g => `${g.away}@${g.home}`)
          });
        }
      }
    }

    // If no cached odds yet and no games started, do initial fetch
    if (!cachedOdds && !newOddsFetched) {
      console.log('No cached odds - doing initial fetch');
      const odds = await fetchOdds();
      if (odds) {
        cachedOdds = odds;
        cachedOddsTimestamp = Date.now();
      }
    }

    // Build response with CACHED odds (not fresh fetch)
    const response = {
      date: getTodayDate(),
      newFetch: newOddsFetched,
      fetchResults,
      gameSlots: Array.from(slots.entries()).map(([key, slot]) => ({
        timeSlot: key,
        lowestQuarter: slot.lowestQuarter,
        allStarted: slot.allStarted,
        games: slot.games,
        oddsHistory: oddsHistory.get(key)?.history || []
      })),
      currentOdds: cachedOdds,  // Use cached odds, NOT fresh fetch
      cachedAt: cachedOddsTimestamp ? new Date(cachedOddsTimestamp).toISOString() : null,
      oddsError: lastOddsError
    };

    res.json(response);

  } catch (error) {
    console.error('Error fetching odds:', error);
    res.status(500).json({ error: 'Failed to fetch odds' });
  }
});

// API endpoint to get odds history only (no new fetches)
app.get('/api/odds/history', (req, res) => {
  const history = {};
  oddsHistory.forEach((value, key) => {
    history[key] = value;
  });
  res.json({ history });
});

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`NBA Tracker running at http://localhost:${PORT}`);
  if (!API_KEY) {
    console.log('\n⚠️  Warning: BALLDONTLIE_API_KEY not set!');
    console.log('Get your free API key at: https://www.balldontlie.io/');
  }
  if (!ODDS_API_KEY) {
    console.log('\n⚠️  Warning: ODDS_API_KEY not set!');
    console.log('Get your free API key at: https://the-odds-api.com/');
  }
  if (!API_KEY || !ODDS_API_KEY) {
    console.log('\nAdd keys to .env file or run with environment variables.\n');
  }
});
