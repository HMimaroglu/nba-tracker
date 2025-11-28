require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const API_KEY = process.env.BALLDONTLIE_API_KEY;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Get today's date in YYYY-MM-DD format
function getTodayDate() {
  const now = new Date();
  return now.toISOString().split('T')[0];
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

// API endpoint to fetch NBA scores
app.get('/api/scores', async (req, res) => {
  try {
    // First try NBA CDN for live scores
    const nbaGames = await fetchNBALiveScores();

    if (nbaGames && nbaGames.length > 0) {
      // Transform NBA CDN format to our format
      const games = nbaGames.map(game => ({
        id: game.gameId,
        status: game.gameStatus === 1 ? 'Scheduled' :
                game.gameStatus === 2 ? `Q${game.period} ${game.gameClock || ''}`.trim() :
                'Final',
        period: game.period,
        time: game.gameClock,
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
      }));

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
    date: getTodayDate()
  });
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
    console.log('Then run: BALLDONTLIE_API_KEY=your_key npm start\n');
  }
});
