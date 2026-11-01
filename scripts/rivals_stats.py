from dotenv import load_dotenv
load_dotenv()
import json
import os
import sys
from rivals_api import RivalsClient

try:
    username = os.getenv("RIVALS_PLAYER_USERNAME")

    if not username:
        raise ValueError("RIVALS_PLAYER_USERNAME is not configured.")

    with RivalsClient() as client:
        player = client.get_player(username)
        results = player.stats.hero_win_rates(season="all")

        heroes = [
            {
                "name": hero.hero_name,
                "games": hero.games,
                "wins": hero.wins,
                "losses": hero.losses,
                "winRate": hero.win_rate_pct,
            }
            for hero in results.data
        ]

        print(json.dumps({
            "name": player.name,
            "level": player.level,
            "heroes": heroes,
            "history": "all available tracked history",
        }))

except Exception as exc:
    print(json.dumps({"error": str(exc)}))
    sys.exit(1)
