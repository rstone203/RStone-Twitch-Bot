# RStone Twitch Bot

A custom Twitch chat bot built with JavaScript, Node.js, and Python. It integrates Twitch chat, moderation, Channel Point redemptions, automated shoutouts, and Marvel Rivals player statistics.

## Features

- Twitch chat commands: `!hello`, `!rivals`, `!redeems`, and `!fulfill`.
- Automated viewer and raid shoutouts with cooldown protection.
- Spam detection with a 10-second timeout.
- Channel Point redemption announcements and management.
- Marvel Rivals player statistics through a Python API client.
- 60-second statistics cache to reduce repeated API requests.
- Environment-based configuration to keep credentials out of source code.

## Technology

- JavaScript and Node.js
- Python
- Twurple
- Twitch API and EventSub WebSocket
- Express
- rivals-api
- python-dotenv

## Setup

1. Install Node.js, npm, and Python 3.
2. Clone this repository.
3. Run `npm install`.
4. Create a Python virtual environment: `python3 -m venv .venv`.
5. Install Python dependencies: `.venv/bin/python -m pip install -r requirements.txt`.
6. Create a local `.env` file with your Twitch credentials and `RIVALS_PLAYER_USERNAME`.
7. Run `npm run check` to check JavaScript syntax.
8. Run `npm start` to start the bot.

Never commit `.env` or share OAuth tokens.

## Notes

- Pending redemptions are stored in memory and are not preserved after a restart.
- Marvel Rivals statistics depend on an external data source.
- Twitch features require correctly configured OAuth credentials and permissions.

## Author

Independently developed as a personal Twitch bot and software portfolio project.
