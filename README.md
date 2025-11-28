# NBA Live Scores Tracker

A sleek, real-time NBA scores tracker built with Node.js and Express. Features live score updates, team logos, and projected final scores for games in progress.

![NBA Tracker Preview](https://cdn.nba.com/logos/leagues/logo-nba.svg)

## Features

- **Live Scores** - Auto-updates every 30 seconds
- **Team Logos** - Official NBA team logos
- **Game Status** - Shows scheduled, live, or final games
- **Projected Scores** - Calculates predicted final scores for live games based on current pace
- **Responsive Design** - Works on desktop and mobile
- **Dark Theme** - Modern dark UI with gradient accents

## Setup

### 1. Get a Free API Key

Sign up for a free API key at [balldontlie.io](https://www.balldontlie.io/)

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

Copy the example environment file and add your API key:

```bash
cp .env.example .env
```

Edit `.env` and replace `your_api_key_here` with your actual API key:

```
BALLDONTLIE_API_KEY=your_actual_api_key
```

### 4. Run the App

```bash
npm start
```

For development with auto-reload:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## How It Works

### Score Projection

For live games, the app calculates a projected final score using:

```
projected_score = (current_score / minutes_played) * 48
```

This gives a simple pace-based prediction that updates in real-time.

## Tech Stack

- **Backend**: Node.js, Express
- **Frontend**: Vanilla HTML/CSS/JavaScript
- **API**: [balldontlie.io](https://www.balldontlie.io/) (free tier: 30 requests/min)
- **Logos**: NBA CDN

## License

MIT
