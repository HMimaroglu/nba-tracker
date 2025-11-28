require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Get API key from environment variable
const API_KEY = process.env.BALLDONTLIE_API_KEY;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Get today's date in YYYY-MM-DD format
function getTodayDate() {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

// API endpoint to fetch NBA games for today
app.get('/api/scores', async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({
      error: 'API key not configured',
      message: 'Please set BALLDONTLIE_API_KEY environment variable'
    });
  }

  try {
    const today = getTodayDate();

    // Fetch games for today
    const gamesResponse = await fetch(
      `https://api.balldontlie.io/v1/games?dates[]=${today}`,
      {
        headers: {
          'Authorization': API_KEY
        }
      }
    );

    if (!gamesResponse.ok) {
      throw new Error(`API returned ${gamesResponse.status}`);
    }

    const gamesData = await gamesResponse.json();

    res.json({
      date: today,
      games: gamesData.data || []
    });
  } catch (error) {
    console.error('Error fetching NBA scores:', error);
    res.status(500).json({ error: 'Failed to fetch NBA scores' });
  }
});

// API endpoint to check if API key is configured
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
