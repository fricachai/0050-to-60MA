from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen


SOURCE_URL = "https://query1.finance.yahoo.com/v8/finance/chart/%5ETWII?interval=1d&range=1y"
OUTPUT_PATH = Path("data/taiex.json")


def main() -> None:
    request = Request(
        SOURCE_URL,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json",
        },
    )
    with urlopen(request, timeout=30) as response:
        payload = json.load(response)

    result = payload["chart"]["result"][0]
    quote = result["indicators"]["quote"][0]
    timestamps = result["timestamp"]
    candles = []

    for index, timestamp in enumerate(timestamps):
        open_price = quote["open"][index]
        high_price = quote["high"][index]
        low_price = quote["low"][index]
        close_price = quote["close"][index]
        volume = quote["volume"][index] or 0
        if None in (open_price, high_price, low_price, close_price):
            continue
        candles.append(
            {
                "date": datetime.fromtimestamp(timestamp, timezone.utc).isoformat(),
                "open": round(float(open_price), 2),
                "high": round(float(high_price), 2),
                "low": round(float(low_price), 2),
                "close": round(float(close_price), 2),
                "volume": int(volume),
            }
        )

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(candles, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
