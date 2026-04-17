from __future__ import annotations

import json
import os
import smtplib
from email.message import EmailMessage
from pathlib import Path


RECIPIENT_EMAIL = "fricachai@gmail.com"
TRACKED_STOCKS = {
    "0050": {"name": "元大台灣50", "path": Path("data/0050.json")},
    "2330": {"name": "台積電", "path": Path("data/2330.json")},
}


def sma(values: list[float], length: int) -> list[float | None]:
    result: list[float | None] = [None] * len(values)
    total = 0.0
    count = 0
    for index, value in enumerate(values):
        total += value
        count += 1
        if index >= length:
            total -= values[index - length]
            count -= 1
        if index >= length - 1 and count > 0:
            result[index] = total / count
    return result


def ema(values: list[float], length: int) -> list[float | None]:
    result: list[float | None] = [None] * len(values)
    alpha = 2 / (length + 1)
    prev = None
    for index, value in enumerate(values):
        prev = value if prev is None else value * alpha + prev * (1 - alpha)
        result[index] = prev
    return result


def compute_macd(closes: list[float]) -> dict[str, list[float | None]]:
    ema12 = ema(closes, 12)
    ema26 = ema(closes, 26)
    dif = [
        ema12[index] - ema26[index] if ema12[index] is not None and ema26[index] is not None else None
        for index in range(len(closes))
    ]
    dea = ema([value if value is not None else 0 for value in dif], 9)
    hist = [
        (dif[index] - dea[index]) * 2 if dif[index] is not None and dea[index] is not None else None
        for index in range(len(closes))
    ]
    return {"dif": dif, "dea": dea, "hist": hist}


def compute_kd(candles: list[dict]) -> dict[str, list[float | None]]:
    k: list[float | None] = [None] * len(candles)
    d: list[float | None] = [None] * len(candles)
    prev_k = 50.0
    prev_d = 50.0
    for index in range(len(candles)):
        window = candles[max(0, index - 8): index + 1]
        highest = max(item["high"] for item in window)
        lowest = min(item["low"] for item in window)
        rsv = 50.0 if highest == lowest else ((candles[index]["close"] - lowest) / (highest - lowest)) * 100
        current_k = (2 / 3) * prev_k + (1 / 3) * rsv
        current_d = (2 / 3) * prev_d + (1 / 3) * current_k
        k[index] = current_k
        d[index] = current_d
        prev_k = current_k
        prev_d = current_d
    return {"k": k, "d": d}


def recent_min(series: list[float | None], end_index: int, lookback: int, fallback: float) -> float:
    values = [value for value in series[max(0, end_index - lookback + 1): end_index + 1] if value is not None]
    return min(values) if values else fallback


def detect_buy_signals(candles: list[dict]) -> list[dict]:
    closes = [float(item["close"]) for item in candles]
    sma60 = sma(closes, 60)
    macd = compute_macd(closes)
    kd = compute_kd(candles)
    signals: list[dict] = []
    last_signal_index = -10

    for index in range(60, len(candles)):
        candle = candles[index]
        prev = candles[index - 1]
        base = sma60[index]
        prev_base = sma60[index - 1]
        hist = macd["hist"][index]
        prev_hist = macd["hist"][index - 1]
        dif = macd["dif"][index]
        prev_dif = macd["dif"][index - 1]
        dea = macd["dea"][index]
        prev_dea = macd["dea"][index - 1]
        k_value = kd["k"][index]
        d_value = kd["d"][index]
        prev_k = kd["k"][index - 1]
        prev_d = kd["d"][index - 1]
        values = [base, prev_base, hist, prev_hist, dif, prev_dif, dea, prev_dea, k_value, d_value, prev_k, prev_d]
        if any(value is None for value in values):
            continue

        recent_hist_min = recent_min(macd["hist"], index, 6, 0)
        recent_k_min = recent_min(kd["k"], index, 6, 50)
        recent_d_min = recent_min(kd["d"], index, 6, 50)
        low_to_base_pct = (candle["low"] - base) / base
        close_to_base_pct = (candle["close"] - base) / base
        near_base = -0.012 <= low_to_base_pct <= 0.02
        pierced_base = candle["low"] < base * 0.998
        recovered_close = candle["close"] >= base * 0.995
        rebound_start = (
            candle["close"] > candle["open"]
            and candle["close"] > prev["close"]
            and candle["close"] >= candle["high"] - (candle["high"] - candle["low"]) * 0.45
        )
        macd_turning_up = hist > prev_hist and dif >= prev_dif and recent_hist_min <= 0
        kd_turning_up = (
            ((k_value > d_value and prev_k <= prev_d) or (k_value > prev_k and d_value >= prev_d))
            and min(recent_k_min, recent_d_min) <= 35
        )
        oscillator_confirmed = macd_turning_up or kd_turning_up
        near_bounce_signal = (
            near_base
            and close_to_base_pct >= -0.003
            and not pierced_base
            and base >= prev_base * 0.997
            and rebound_start
            and oscillator_confirmed
        )
        reclaim_signal = (
            pierced_base
            and recovered_close
            and candle["close"] >= prev["close"]
            and rebound_start
            and oscillator_confirmed
        )

        if (near_bounce_signal or reclaim_signal) and index - last_signal_index >= 4:
            confirmers = []
            if macd_turning_up:
                confirmers.append("MACD")
            if kd_turning_up:
                confirmers.append("KD")
            signals.append(
                {
                    "index": index,
                    "date": candle["date"][:10],
                    "close": candle["close"],
                    "type": "收復SMA60" if reclaim_signal else "貼近SMA60轉強",
                    "confirmers": "/".join(confirmers) or "MACD/KD",
                }
            )
            last_signal_index = index
    return signals


def load_candles(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))


def build_alert_lines() -> list[str]:
    lines: list[str] = []
    for code, config in TRACKED_STOCKS.items():
        candles = load_candles(config["path"])
        signals = detect_buy_signals(candles)
        if not signals:
            continue
        latest_signal = signals[-1]
        latest_date = candles[-1]["date"][:10]
        if latest_signal["date"] != latest_date:
            continue
        lines.append(
            f"{code} {config['name']} 在 {latest_signal['date']} 出現買點："
            f"{latest_signal['type']}，收盤 {latest_signal['close']:.2f}，確認指標 {latest_signal['confirmers']}"
        )
    return lines


def send_email(lines: list[str]) -> None:
    host = os.environ.get("SMTP_HOST")
    port = int(os.environ.get("SMTP_PORT", "587"))
    username = os.environ.get("SMTP_USERNAME")
    password = os.environ.get("SMTP_PASSWORD")
    sender = os.environ.get("ALERT_FROM_EMAIL") or username
    if not all([host, username, password, sender]):
        raise RuntimeError("Missing SMTP configuration. Set SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, ALERT_FROM_EMAIL.")

    message = EmailMessage()
    message["Subject"] = "0050 / 2330 買點提醒"
    message["From"] = sender
    message["To"] = RECIPIENT_EMAIL
    message.set_content(
        "偵測到符合 SMA60 附近轉強條件的買點：\n\n"
        + "\n".join(f"- {line}" for line in lines)
        + "\n\n此信由 GitHub Actions 自動寄送。"
    )

    with smtplib.SMTP(host, port, timeout=30) as server:
        server.starttls()
        server.login(username, password)
        server.send_message(message)


def main() -> None:
    lines = build_alert_lines()
    if not lines:
        print("No buy alerts today.")
        return
    send_email(lines)
    print("\n".join(lines))


if __name__ == "__main__":
    main()
