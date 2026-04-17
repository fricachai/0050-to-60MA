from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen


TAIEX_SOURCE_URL = "https://query1.finance.yahoo.com/v8/finance/chart/%5ETWII?interval=1d&range=1y"
TAIEX_OUTPUT_PATH = Path("data/taiex.json")
TWSE_STOCK_DAY_URL = "https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date={date_key}&stockNo={stock_code}"
STOCK_OUTPUT_PATHS = {
    "0050": Path("data/0050.json"),
    "2330": Path("data/2330.json"),
}


def fetch_json(url: str) -> dict:
    request = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json",
        },
    )
    with urlopen(request, timeout=30) as response:
        return json.load(response)


def fetch_taiex() -> list[dict]:
    payload = fetch_json(TAIEX_SOURCE_URL)
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
    return candles


def roc_to_iso(date_text: str) -> str:
    roc_year, month, day = [int(part) for part in date_text.split("/")]
    return datetime(roc_year + 1911, month, day, tzinfo=timezone.utc).isoformat()


def recent_month_keys(count: int = 8) -> list[str]:
    now = datetime.now(timezone.utc)
    year = now.year
    month = now.month
    keys = []
    for offset in range(count):
        current_month = month - offset
        current_year = year
        while current_month <= 0:
            current_month += 12
            current_year -= 1
        keys.append(f"{current_year}{current_month:02d}01")
    return keys


def parse_number(value: str) -> float | None:
    cleaned = str(value).replace(",", "").strip()
    if not cleaned or cleaned in {"--", "---"}:
        return None
    return float(cleaned)


def fetch_stock(stock_code: str) -> list[dict]:
    candles = []
    for date_key in recent_month_keys(8):
        payload = fetch_json(TWSE_STOCK_DAY_URL.format(date_key=date_key, stock_code=stock_code))
        if payload.get("stat") != "OK":
            continue
        for row in payload.get("data", []):
            open_price = parse_number(row[3])
            high_price = parse_number(row[4])
            low_price = parse_number(row[5])
            close_price = parse_number(row[6])
            volume = int(parse_number(row[1]) or 0)
            if None in (open_price, high_price, low_price, close_price):
                continue
            candles.append(
                {
                    "date": roc_to_iso(row[0]),
                    "open": round(open_price, 2),
                    "high": round(high_price, 2),
                    "low": round(low_price, 2),
                    "close": round(close_price, 2),
                    "volume": volume,
                }
            )
    candles.sort(key=lambda row: row["date"])
    deduped = []
    seen = set()
    for candle in candles:
        if candle["date"] in seen:
            continue
        seen.add(candle["date"])
        deduped.append(candle)
    return deduped


def main() -> None:
    taiex_candles = fetch_taiex()
    stock_candles = {
        stock_code: fetch_stock(stock_code)
        for stock_code in STOCK_OUTPUT_PATHS
    }

    TAIEX_OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    TAIEX_OUTPUT_PATH.write_text(json.dumps(taiex_candles, ensure_ascii=False, indent=2), encoding="utf-8")
    for stock_code, output_path in STOCK_OUTPUT_PATHS.items():
        output_path.write_text(json.dumps(stock_candles[stock_code], ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
