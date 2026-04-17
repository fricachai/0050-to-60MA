const canvas = document.getElementById("chartCanvas");
const ctx = canvas.getContext("2d");
const chartTitle = document.getElementById("chartTitle");
const closeInfo = document.getElementById("closeInfo");
const watchlistEl = document.getElementById("watchlist");
const stockForm = document.getElementById("stockForm");
const codeInput = document.getElementById("codeInput");
const nameInput = document.getElementById("nameInput");
const searchInput = document.getElementById("searchInput");
const statusText = document.getElementById("statusText");
const watchlistFileInput = document.getElementById("watchlistFileInput");
const priceFileInput = document.getElementById("priceFileInput");
const timeframeSelect = document.getElementById("timeframeSelect");
const authorCard = document.querySelector(".author-card");
const authorBubbles = [...document.querySelectorAll(".author-bubble")];

const DEFAULT_STOCKS = [
  { code: "0050", name: "元大台灣50" },
  { code: "2330", name: "台積電" },
];

const timeframeHours = { "1h": 1, "2h": 2, "3h": 3, "4h": 4, "1d": 24 };
const timeframeLabels = { "1h": "1小時", "2h": "2小時", "3h": "3小時", "4h": "4小時", "1d": "1日" };

const state = {
  stocks: [],
  rawCandlesByCode: new Map(),
  selectedCode: null,
  loadingCodes: new Set(),
  chartView: { visibleCount: 36, priceScale: 1, hoverZone: "", hoverX: null, barOffset: 0, panX: 0, panY: 0 },
  chartLayout: null,
  timeframe: "1d",
  dragState: null,
};

function setStatus(message, type = "") {
  statusText.textContent = message;
  statusText.className = `status-text${type ? ` ${type}` : ""}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return "--";
  return Number(value).toLocaleString("zh-TW", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatCompactNumber(value) {
  if (!Number.isFinite(value)) return "--";
  const abs = Math.abs(value);
  if (abs >= 100000000) return `${formatNumber(value / 100000000, 2)}億`;
  if (abs >= 10000) return `${formatNumber(value / 10000, 2)}萬`;
  return formatNumber(value, 0);
}

function describeFetchError(error) {
  const message = String(error?.message || error || "");
  if (message === "Failed to fetch") {
    return "瀏覽器連不到外部資料端點";
  }
  return message;
}

function canonicalizeCode(rawCode) {
  const code = String(rawCode || "").trim().toUpperCase();
  if (!code) return "";
  if (["大盤", "TAIEX", "TWII", "^TWII", "加權指數"].includes(code)) return "大盤";
  return code;
}

function isMarketIndexCode(code) {
  return canonicalizeCode(code) === "大盤";
}

function getAuthorBorderPoint(width, height) {
  const margin = 10;
  const side = Math.floor(Math.random() * 4);
  if (side === 0) return { x: rand(12, width - 12), y: -margin };
  if (side === 1) return { x: width + margin, y: rand(10, height - 10) };
  if (side === 2) return { x: rand(12, width - 12), y: height + margin };
  return { x: -margin, y: rand(10, height - 10) };
}

function randomBubbleGradient() {
  const palettes = [
    ["#fff8bd", "#ff91d9"],
    ["#fff6b8", "#ffc989"],
    ["#f8ffff", "#9adfff"],
    ["#fff6d8", "#cda6ff"],
    ["#fff4ad", "#ff94c9"],
  ];
  const [a, b] = palettes[Math.floor(Math.random() * palettes.length)];
  return `radial-gradient(circle at 34% 34%, ${a}, ${b} 56%, rgba(255,255,255,0.08) 78%, transparent 80%)`;
}

function animateAuthorBubble(bubble) {
  if (!authorCard || !bubble) return;
  const width = authorCard.offsetWidth;
  const height = authorCard.offsetHeight;
  if (!width || !height) return;
  const start = getAuthorBorderPoint(width, height);
  const end = getAuthorBorderPoint(width, height);
  const size = rand(4, 12);
  const duration = rand(2200, 7600);
  const driftX = rand(-8, 8);
  const driftY = rand(-8, 8);
  bubble.style.width = `${size}px`;
  bubble.style.height = `${size}px`;
  bubble.style.background = randomBubbleGradient();
  bubble.style.boxShadow = `0 0 ${Math.round(size + 4)}px rgba(255,255,255,0.42)`;
  bubble.style.transform = `translate(${start.x}px, ${start.y}px)`;
  bubble.getAnimations().forEach((anim) => anim.cancel());
  const animation = bubble.animate(
    [
      { transform: `translate(${start.x}px, ${start.y}px) scale(${rand(0.7, 1.1)})`, opacity: rand(0.35, 0.9) },
      { transform: `translate(${(start.x + end.x) / 2 + driftX}px, ${(start.y + end.y) / 2 + driftY}px) scale(${rand(0.9, 1.35)})`, opacity: rand(0.45, 1) },
      { transform: `translate(${end.x}px, ${end.y}px) scale(${rand(0.55, 1.05)})`, opacity: rand(0.2, 0.75) },
    ],
    { duration, easing: "ease-in-out", fill: "forwards" },
  );
  animation.onfinish = () => {
    setTimeout(() => animateAuthorBubble(bubble), rand(120, 900));
  };
}

function initAuthorCardEffects() {
  if (!authorCard || !authorBubbles.length) return;
  authorBubbles.forEach((bubble, index) => {
    setTimeout(() => animateAuthorBubble(bubble), index * 180);
  });
}

function sma(values, length) {
  const result = Array(values.length).fill(null);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] != null) {
      sum += values[i];
      count += 1;
    }
    if (i >= length && values[i - length] != null) {
      sum -= values[i - length];
      count -= 1;
    }
    if (i >= length - 1 && count > 0) result[i] = sum / count;
  }
  return result;
}

function ema(values, length) {
  const result = Array(values.length).fill(null);
  const alpha = 2 / (length + 1);
  let prev = null;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value == null) continue;
    prev = prev == null ? value : value * alpha + prev * (1 - alpha);
    result[i] = prev;
  }
  return result;
}

function computeMacd(candles) {
  const closes = candles.map((c) => c.close);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const dif = closes.map((_, i) => (ema12[i] != null && ema26[i] != null ? ema12[i] - ema26[i] : null));
  const dea = ema(dif, 9);
  const hist = dif.map((value, i) => (value != null && dea[i] != null ? (value - dea[i]) * 2 : null));
  return { dif, dea, hist };
}

function computeKd(candles) {
  const k = Array(candles.length).fill(null);
  const d = Array(candles.length).fill(null);
  let prevK = 50;
  let prevD = 50;
  for (let i = 0; i < candles.length; i += 1) {
    const start = Math.max(0, i - 8);
    const slice = candles.slice(start, i + 1);
    const highest = Math.max(...slice.map((c) => c.high));
    const lowest = Math.min(...slice.map((c) => c.low));
    const rsv = highest === lowest ? 50 : ((candles[i].close - lowest) / (highest - lowest)) * 100;
    const currentK = (2 / 3) * prevK + (1 / 3) * rsv;
    const currentD = (2 / 3) * prevD + (1 / 3) * currentK;
    k[i] = currentK;
    d[i] = currentD;
    prevK = currentK;
    prevD = currentD;
  }
  return { k, d };
}

function drawText(text, x, y, color = "#f5f6fa", size = 14, align = "left") {
  ctx.fillStyle = color;
  ctx.font = `${size}px "Segoe UI", "Noto Sans TC", sans-serif`;
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
}

function drawRoundRect(x, y, width, height, radius, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getNativeIntervalHours(candles) {
  if (candles.length < 2) return 24;
  let minDiff = Number.POSITIVE_INFINITY;
  for (let i = 1; i < candles.length; i += 1) {
    const diff = (new Date(candles[i].date) - new Date(candles[i - 1].date)) / 3600000;
    if (diff > 0 && diff < minDiff) minDiff = diff;
  }
  return Number.isFinite(minDiff) ? minDiff : 24;
}

function aggregateCandles(rawCandles, timeframe) {
  if (!rawCandles.length) return { candles: [], effectiveTimeframe: timeframe, fallback: false };
  const targetHours = timeframeHours[timeframe] ?? 24;
  const nativeHours = getNativeIntervalHours(rawCandles);
  if (nativeHours > targetHours) {
    return { candles: rawCandles, effectiveTimeframe: nativeHours >= 24 ? "1d" : timeframe, fallback: true };
  }
  if (nativeHours === targetHours) return { candles: rawCandles, effectiveTimeframe: timeframe, fallback: false };

  const buckets = [];
  let current = null;
  rawCandles.forEach((candle) => {
    const date = new Date(candle.date);
    const bucketHour = targetHours >= 24 ? 0 : Math.floor(date.getHours() / targetHours) * targetHours;
    const bucketKey = targetHours >= 24
      ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
      : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${bucketHour}`;
    if (!current || current.key !== bucketKey) {
      current = {
        key: bucketKey,
        date: candle.date,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume ?? 0,
      };
      buckets.push(current);
    } else {
      current.high = Math.max(current.high, candle.high);
      current.low = Math.min(current.low, candle.low);
      current.close = candle.close;
      current.volume += candle.volume ?? 0;
    }
  });

  return { candles: buckets.map(({ key, ...rest }) => rest), effectiveTimeframe: timeframe, fallback: false };
}

function getDisplayCandles(code) {
  return aggregateCandles(state.rawCandlesByCode.get(code) || [], state.timeframe);
}

function resetChartView() {
  state.chartView.visibleCount = 36;
  state.chartView.priceScale = 1;
  state.chartView.barOffset = 0;
  state.chartView.panX = 0;
  state.chartView.panY = 0;
}

function getSeriesRange(seriesList, fallbackMin, fallbackMax) {
  const values = seriesList.flatMap((series) => series.filter((value) => value != null));
  if (!values.length) return { min: fallbackMin, max: fallbackMax };
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  return { min, max };
}

function drawLineSeries(area, candleWidth, panX, series, mapY, color, lineWidth = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  let started = false;
  series.forEach((value, i) => {
    if (value == null) return;
    const x = area.x + i * candleWidth + candleWidth / 2 + panX;
    const y = mapY(value);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  });
  if (started) ctx.stroke();
}

function renderChart(stock) {
  const { candles, effectiveTimeframe, fallback } = getDisplayCandles(stock.code);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawRoundRect(0, 0, canvas.width, canvas.height, 18, "#0b0c10", "#1f2330");

  if (!candles.length) {
    drawText("尚未載入這個商品的 K 線資料", 60, 120, "#f5f6fa", 28);
    drawText("請點選右側商品，或匯入 `code,name,date,open,high,low,close,volume` 格式 CSV", 60, 160, "#97a0af", 18);
    state.chartLayout = null;
    return { effectiveTimeframe, fallback, lastClose: null };
  }

  const closes = candles.map((c) => c.close);
  const sma5 = sma(closes, 5);
  const sma20 = sma(closes, 20);
  const sma60 = sma(closes, 60);
  const macd = computeMacd(candles);
  const kd = computeKd(candles);
  const lastCandle = candles[candles.length - 1];
  const prevClose = candles[candles.length - 2]?.close ?? lastCandle.close;
  const changeValue = lastCandle.close - prevClose;
  const changePct = prevClose === 0 ? 0 : ((lastCandle.close / prevClose) - 1) * 100;

  const priceArea = { x: 42, y: 72, w: 1120, h: 350 };
  const xAxisArea = { x: 42, y: 430, w: 1120, h: 38 };
  const priceScaleArea = { x: 1162, y: 72, w: 78, h: 350 };
  const volumeArea = { x: 42, y: 500, w: 1198, h: 100 };
  const macdArea = { x: 42, y: 630, w: 1198, h: 110 };
  const kdjArea = { x: 42, y: 770, w: 1198, h: 100 };
  state.chartLayout = { priceArea, xAxisArea, priceScaleArea, volumeArea, macdArea, kdjArea };

  drawRoundRect(
    xAxisArea.x,
    xAxisArea.y,
    xAxisArea.w,
    xAxisArea.h,
    8,
    state.chartView.hoverZone === "xAxis" ? "rgba(247,200,67,0.08)" : "rgba(255,255,255,0.03)",
    state.chartView.hoverZone === "xAxis" ? "rgba(247,200,67,0.4)" : null,
  );
  drawRoundRect(
    priceScaleArea.x,
    priceScaleArea.y,
    priceScaleArea.w,
    priceScaleArea.h,
    8,
    state.chartView.hoverZone === "priceScale" ? "rgba(41,105,255,0.08)" : "rgba(255,255,255,0.03)",
    state.chartView.hoverZone === "priceScale" ? "rgba(41,105,255,0.45)" : null,
  );

  drawText(`${stock.name} · ${timeframeLabels[effectiveTimeframe]} · TWSE`, 42, 42, "#f5f6fa", 24);
  drawText(`${stock.code}`, 360, 42, "#f7c843", 20);
  drawText(`${round(changeValue, 2)} (${round(changePct, 2)}%)`, 460, 42, changeValue >= 0 ? "#15d18d" : "#ff5263", 18);

  drawRoundRect(volumeArea.x, volumeArea.y - 6, volumeArea.w, volumeArea.h + 12, 10, "rgba(255,255,255,0.015)", null);
  drawRoundRect(macdArea.x, macdArea.y - 6, macdArea.w, macdArea.h + 12, 10, "rgba(255,255,255,0.015)", null);
  drawRoundRect(kdjArea.x, kdjArea.y - 6, kdjArea.w, kdjArea.h + 12, 10, "rgba(255,255,255,0.015)", null);

  const visibleCount = clamp(state.chartView.visibleCount, 20, Math.min(220, candles.length));
  state.chartView.visibleCount = visibleCount;
  const maxBarOffset = Math.max(0, candles.length - visibleCount);
  state.chartView.barOffset = clamp(state.chartView.barOffset, 0, maxBarOffset);
  const startIndex = Math.max(0, candles.length - visibleCount - state.chartView.barOffset);
  const endIndex = startIndex + visibleCount;

  const visible = candles.slice(startIndex, endIndex);
  const visibleSma5 = sma5.slice(startIndex, endIndex);
  const visibleSma20 = sma20.slice(startIndex, endIndex);
  const visibleSma60 = sma60.slice(startIndex, endIndex);
  const visibleVolume = visible.map((c) => c.volume ?? 0);
  const visibleMacdHist = macd.hist.slice(startIndex, endIndex);
  const visibleMacdDif = macd.dif.slice(startIndex, endIndex);
  const visibleMacdDea = macd.dea.slice(startIndex, endIndex);
  const visibleK = kd.k.slice(startIndex, endIndex);
  const visibleD = kd.d.slice(startIndex, endIndex);

  const priceRangeSource = [
    ...visible.map((c) => c.low),
    ...visible.map((c) => c.high),
    ...visibleSma5.filter((v) => v != null),
    ...visibleSma20.filter((v) => v != null),
    ...visibleSma60.filter((v) => v != null),
  ];
  const rawMinPrice = Math.min(...priceRangeSource);
  const rawMaxPrice = Math.max(...priceRangeSource);
  const rawMidBase = (rawMinPrice + rawMaxPrice) / 2;
  const rawHalfRange = Math.max((rawMaxPrice - rawMinPrice) / 2, Math.max(rawMidBase * 0.01, 1));
  const scaledHalfRange = rawHalfRange * state.chartView.priceScale;
  const baseMinPrice = rawMidBase - scaledHalfRange;
  const baseMaxPrice = rawMidBase + scaledHalfRange;
  const visiblePriceRange = baseMaxPrice - baseMinPrice || 1;
  const verticalPriceShift = (state.chartView.panY / priceArea.h) * visiblePriceRange;
  const minPrice = baseMinPrice + verticalPriceShift;
  const maxPrice = baseMaxPrice + verticalPriceShift;
  const mapPriceY = (price) => priceArea.y + ((maxPrice - price) / (maxPrice - minPrice || 1)) * priceArea.h;

  for (let i = 0; i <= 6; i += 1) {
    const y = priceArea.y + (priceArea.h / 6) * i;
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.moveTo(priceArea.x, y);
    ctx.lineTo(priceScaleArea.x + priceScaleArea.w, y);
    ctx.stroke();
  }

  for (let i = 0; i <= 5; i += 1) {
    const price = maxPrice - ((maxPrice - minPrice) / 5) * i;
    const y = priceArea.y + (priceArea.h / 5) * i;
    drawText((round(price, 2) ?? price).toFixed(2), priceScaleArea.x + priceScaleArea.w - 8, y + 4, "#c8d0dd", 12, "right");
  }

  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.beginPath();
  ctx.moveTo(priceScaleArea.x, priceArea.y);
  ctx.lineTo(priceScaleArea.x, priceArea.y + priceArea.h);
  ctx.stroke();

  const candleWidth = priceArea.w / visible.length;
  const panX = state.chartView.panX;
  ctx.save();
  ctx.beginPath();
  ctx.rect(priceArea.x, priceArea.y, priceArea.w, priceArea.h);
  ctx.clip();

  visible.forEach((candle, i) => {
    const x = priceArea.x + i * candleWidth + candleWidth / 2 + panX;
    const openY = mapPriceY(candle.open);
    const closeY = mapPriceY(candle.close);
    const highY = mapPriceY(candle.high);
    const lowY = mapPriceY(candle.low);
    const color = candle.close >= candle.open ? "#ff3b30" : "#00c853";
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, highY);
    ctx.lineTo(x, lowY);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillRect(x - candleWidth * 0.3, Math.min(openY, closeY), candleWidth * 0.6, Math.max(2, Math.abs(closeY - openY)));
  });

  drawLineSeries(priceArea, candleWidth, panX, visibleSma5, mapPriceY, "#36b4ff", 2.2);
  drawLineSeries(priceArea, candleWidth, panX, visibleSma20, mapPriceY, "#f7c843", 2.2);
  drawLineSeries(priceArea, candleWidth, panX, visibleSma60, mapPriceY, "#ff5e67", 2.2);
  ctx.restore();

  drawText("SMA5", priceArea.x + 10, priceArea.y + 18, "#36b4ff", 12);
  drawText("SMA20", priceArea.x + 74, priceArea.y + 18, "#f7c843", 12);
  drawText("SMA60", priceArea.x + 150, priceArea.y + 18, "#ff5e67", 12);

  const volumeMax = Math.max(1, ...visibleVolume);
  const mapVolumeY = (value) => volumeArea.y + ((volumeMax - value) / volumeMax) * volumeArea.h;
  ctx.save();
  ctx.beginPath();
  ctx.rect(volumeArea.x, volumeArea.y, volumeArea.w, volumeArea.h);
  ctx.clip();
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.beginPath();
  ctx.moveTo(volumeArea.x, volumeArea.y + volumeArea.h);
  ctx.lineTo(volumeArea.x + volumeArea.w, volumeArea.y + volumeArea.h);
  ctx.stroke();
  visible.forEach((candle, i) => {
    const x = volumeArea.x + i * candleWidth + candleWidth / 2 + panX;
    const y = mapVolumeY(candle.volume ?? 0);
    const color = candle.close >= candle.open ? "rgba(255,59,48,0.82)" : "rgba(0,200,83,0.82)";
    ctx.fillStyle = color;
    ctx.fillRect(x - candleWidth * 0.32, y, candleWidth * 0.64, volumeArea.y + volumeArea.h - y);
  });
  ctx.restore();

  const macdRange = getSeriesRange([visibleMacdHist, visibleMacdDif, visibleMacdDea], -1, 1);
  const macdMin = Math.min(-1, macdRange.min);
  const macdMax = Math.max(1, macdRange.max);
  const mapMacdY = (value) => macdArea.y + ((macdMax - value) / (macdMax - macdMin || 1)) * macdArea.h;
  const macdZeroY = mapMacdY(0);
  ctx.save();
  ctx.beginPath();
  ctx.rect(macdArea.x, macdArea.y, macdArea.w, macdArea.h);
  ctx.clip();
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.beginPath();
  ctx.moveTo(macdArea.x, macdZeroY);
  ctx.lineTo(macdArea.x + macdArea.w, macdZeroY);
  ctx.stroke();
  visibleMacdHist.forEach((value, i) => {
    if (value == null) return;
    const x = macdArea.x + i * candleWidth + candleWidth / 2 + panX;
    const y = mapMacdY(value);
    ctx.fillStyle = value >= 0 ? "rgba(255,59,48,0.82)" : "rgba(0,200,83,0.82)";
    ctx.fillRect(x - candleWidth * 0.32, Math.min(y, macdZeroY), candleWidth * 0.64, Math.abs(macdZeroY - y));
  });
  drawLineSeries(macdArea, candleWidth, panX, visibleMacdDif, mapMacdY, "#2d73ff", 2);
  drawLineSeries(macdArea, candleWidth, panX, visibleMacdDea, mapMacdY, "#ff9f1a", 2);
  ctx.restore();

  const kdRange = getSeriesRange([visibleK, visibleD], 0, 100);
  const kdMin = Math.min(0, kdRange.min);
  const kdMax = Math.max(100, kdRange.max);
  const mapKdY = (value) => kdjArea.y + ((kdMax - value) / (kdMax - kdMin || 1)) * kdjArea.h;
  ctx.save();
  ctx.beginPath();
  ctx.rect(kdjArea.x, kdjArea.y, kdjArea.w, kdjArea.h);
  ctx.clip();
  [20, 50, 80].forEach((level) => {
    const y = mapKdY(level);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(kdjArea.x, y);
    ctx.lineTo(kdjArea.x + kdjArea.w, y);
    ctx.stroke();
    ctx.setLineDash([]);
  });
  drawLineSeries(kdjArea, candleWidth, panX, visibleK, mapKdY, "#36b4ff", 2);
  drawLineSeries(kdjArea, candleWidth, panX, visibleD, mapKdY, "#f7c843", 2);
  ctx.restore();

  drawText("成交量", volumeArea.x, volumeArea.y - 12, "#97a0af", 14);
  drawText("MACD", macdArea.x, macdArea.y - 12, "#97a0af", 14);
  drawText("KD", kdjArea.x, kdjArea.y - 12, "#97a0af", 14);

  if (state.chartView.hoverX != null) {
    const lineLeft = priceArea.x;
    const lineRight = xAxisArea.x + xAxisArea.w;
    const lineX = clamp(state.chartView.hoverX, lineLeft, lineRight);
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(lineX, priceArea.y);
    ctx.lineTo(lineX, kdjArea.y + kdjArea.h);
    ctx.stroke();
  }

  const leftDate = formatDate(visible[0].date);
  const midDate = formatDate(visible[Math.floor((visible.length - 1) / 2)].date);
  const rightDate = formatDate(visible[visible.length - 1].date);
  drawText(leftDate, xAxisArea.x + 4, xAxisArea.y + 24, "#97a0af", 12);
  drawText(midDate, xAxisArea.x + xAxisArea.w / 2, xAxisArea.y + 24, "#97a0af", 12, "center");
  drawText(rightDate, xAxisArea.x + xAxisArea.w - 4, xAxisArea.y + 24, "#97a0af", 12, "right");
  drawText("時間軸: 滾輪縮放", xAxisArea.x + 10, xAxisArea.y + 12, state.chartView.hoverZone === "xAxis" ? "#ffe27a" : "rgba(151,160,175,0.85)", 11);
  drawText("價格軸: 滾輪縮放", priceScaleArea.x + priceScaleArea.w - 6, priceScaleArea.y + priceScaleArea.h + 16, state.chartView.hoverZone === "priceScale" ? "#7ab5ff" : "rgba(151,160,175,0.85)", 11, "right");
  return { effectiveTimeframe, fallback, lastClose: lastCandle.close };
}

function renderWatchlist() {
  const keyword = searchInput.value.trim().toLowerCase();
  watchlistEl.innerHTML = "";
  state.stocks
    .filter((stock) => !keyword || stock.code.toLowerCase().includes(keyword) || stock.name.toLowerCase().includes(keyword))
    .forEach((stock) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `watch-item ${stock.code === state.selectedCode ? "active" : ""}`;
      item.innerHTML = `<span class="watch-code">${stock.code}</span><span class="watch-name">${stock.name}</span>`;
      item.addEventListener("click", async () => {
        state.selectedCode = stock.code;
        resetChartView();
        renderAll();
        if (!state.rawCandlesByCode.has(stock.code)) await ensureStockData(stock.code, stock.name);
      });
      watchlistEl.appendChild(item);
    });
}

function renderAll() {
  const stock = state.stocks.find((entry) => entry.code === state.selectedCode) || state.stocks[0];
  if (!stock) return;
  state.selectedCode = stock.code;
  renderWatchlist();
  const chartResult = renderChart(stock);
  chartTitle.textContent = `${stock.code} ${stock.name}`;
  closeInfo.textContent = `最新收盤價：${chartResult.lastClose != null ? formatNumber(chartResult.lastClose, 2) : "--"}`;
  if (chartResult.fallback && state.timeframe !== "1d") {
    setStatus(`目前官方資料只有日 K，${stock.code} 已自動改用 1日顯示。`, "error");
  }
}

function upsertStock(stock) {
  const normalized = canonicalizeCode(stock.code);
  if (!normalized) return;
  const name = stock.name || normalized;
  const existing = state.stocks.find((entry) => entry.code === normalized);
  if (existing) {
    existing.name = name;
  } else {
    state.stocks.push({ code: normalized, name });
  }
  if (!state.selectedCode) state.selectedCode = normalized;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(",").map((cell) => cell.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((cell) => cell.trim());
    return Object.fromEntries(header.map((key, index) => [key, values[index] ?? ""]));
  });
}

function getRecentMonthKeys(count = 8) {
  const keys = [];
  const cursor = new Date();
  cursor.setDate(1);
  for (let i = 0; i < count; i += 1) {
    keys.push(`${cursor.getFullYear()}${String(cursor.getMonth() + 1).padStart(2, "0")}01`);
    cursor.setMonth(cursor.getMonth() - 1);
  }
  return keys;
}

function parseTwseDate(value) {
  const [rocYear, month, day] = String(value || "").split("/").map(Number);
  if (!rocYear || !month || !day) return null;
  return new Date(rocYear + 1911, month - 1, day).toISOString();
}

function parseNumber(value) {
  if (value == null) return null;
  const cleaned = String(value).replace(/,/g, "").trim();
  if (!cleaned || cleaned === "--" || cleaned === "---") return null;
  return Number(cleaned);
}

function extractNameFromTitle(title, code) {
  if (!title) return code;
  const cleaned = title.replace(/\s+/g, " ").trim();
  const afterCode = cleaned.split(`${code} `)[1] || "";
  return afterCode.split(" ").find(Boolean) || code;
}

async function fetchTwseMonth(code, dateKey) {
  const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${dateKey}&stockNo=${encodeURIComponent(code)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.stat !== "OK") return { title: payload.title || "", rows: [] };
  const rows = (payload.data || [])
    .map((row) => ({
      date: parseTwseDate(row[0]),
      open: parseNumber(row[3]),
      high: parseNumber(row[4]),
      low: parseNumber(row[5]),
      close: parseNumber(row[6]),
      volume: parseNumber(row[1]) ?? 0,
    }))
    .filter((row) => row.date && [row.open, row.high, row.low, row.close].every(Number.isFinite));
  return { title: payload.title || "", rows };
}

async function fetchTwseStockData(code) {
  const results = await Promise.all(getRecentMonthKeys(8).map((key) => fetchTwseMonth(code, key)));
  const nameSource = results.find((item) => item.title)?.title || "";
  const candles = results.flatMap((item) => item.rows).sort((a, b) => new Date(a.date) - new Date(b.date));
  const deduped = candles.filter((candle, index, array) => index === 0 || candle.date !== array[index - 1].date);
  if (!deduped.length) throw new Error("No official daily data");
  return { code, name: extractNameFromTitle(nameSource, code), candles: deduped };
}

function normalizeCandlePayload(rows) {
  return rows
    .map((row) => ({
      date: row.date,
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume || 0),
    }))
    .filter((row) => row.date && [row.open, row.high, row.low, row.close].every(Number.isFinite))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

async function fetchCachedCandles(path) {
  const response = await fetch(`${path}?ts=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const candles = normalizeCandlePayload(Array.isArray(payload) ? payload : payload.candles || []);
  if (!candles.length) throw new Error("No cached data");
  return candles;
}

async function fetchCachedStockData(code, fallbackName) {
  const candles = await fetchCachedCandles(`./data/${code}.json`);
  return { code, name: fallbackName || code, candles };
}

async function fetchTaiexData() {
  const candles = await fetchCachedCandles("./data/taiex.json");
  return { code: "大盤", name: "加權指數", candles };
}

async function fetchInstrumentData(code) {
  if (isMarketIndexCode(code)) return fetchTaiexData();
  return fetchTwseStockData(code);
}

async function fetchInstrumentDataWithFallback(code, preferredName = "") {
  try {
    return await fetchInstrumentData(code);
  } catch (error) {
    if (isMarketIndexCode(code)) {
      const cached = await fetchTaiexData();
      return { ...cached, sourceError: error };
    }
    const cached = await fetchCachedStockData(code, preferredName);
    return { ...cached, sourceError: error };
  }
}

async function ensureStockData(code, preferredName = "") {
  const normalizedCode = canonicalizeCode(code);
  if (!normalizedCode || state.loadingCodes.has(normalizedCode)) return false;
  state.loadingCodes.add(normalizedCode);
  setStatus(`正在抓取 ${normalizedCode} 的 TWSE 官方資料...`);
  try {
    const result = await fetchInstrumentDataWithFallback(normalizedCode, preferredName || "");
    upsertStock({ code: result.code, name: preferredName || result.name });
    state.rawCandlesByCode.set(normalizedCode, result.candles);
    state.selectedCode = normalizedCode;
    renderAll();
    if (result.sourceError) {
      const errorMessage = describeFetchError(result.sourceError);
      setStatus(`${normalizedCode} 官方資料暫時無法取得，已改用站內快取資料。原因：${errorMessage}`, "success");
    } else if (state.timeframe === "1d") {
      setStatus(`已載入 ${normalizedCode} ${preferredName || result.name} 的官方日 K 資料。`, "success");
    }
    return true;
  } catch (error) {
    if (preferredName) {
      upsertStock({ code: normalizedCode, name: preferredName });
      renderAll();
    }
    const errorMessage = describeFetchError(error);
    if (isMarketIndexCode(normalizedCode)) {
      setStatus(`大盤載入失敗：${errorMessage}。目前大盤改讀站內的快取資料檔，若仍失敗，通常是 GitHub Pages 尚未部署最新的 taiex.json。`, "error");
    } else {
      setStatus(`${normalizedCode} 載入失敗：${errorMessage}`, "error");
    }
    return false;
  } finally {
    state.loadingCodes.delete(normalizedCode);
  }
}

async function loadWatchlistRows(rows) {
  rows.forEach((row) => {
    if (!row.code) return;
    upsertStock({ code: row.code, name: row.name || row.code });
  });
  renderAll();
  for (const row of rows) {
    if (!row.code) continue;
    const code = canonicalizeCode(row.code);
    if (!state.rawCandlesByCode.has(code)) await ensureStockData(code, row.name || "");
  }
}

function loadPriceRows(rows) {
  const grouped = new Map();
  rows.forEach((row) => {
    if (!row.code || !row.date) return;
    const code = canonicalizeCode(row.code);
    const list = grouped.get(code) ?? [];
    list.push({
      date: row.date,
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume || 0),
    });
    grouped.set(code, list);
    if (row.name) upsertStock({ code, name: row.name });
  });
  grouped.forEach((candles, code) => {
    candles.sort((a, b) => new Date(a.date) - new Date(b.date));
    state.rawCandlesByCode.set(code, candles.filter((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite)));
  });
  if (!state.selectedCode && grouped.size) state.selectedCode = [...grouped.keys()][0];
  renderAll();
}

function readFile(file, callback) {
  const reader = new FileReader();
  reader.onload = () => callback(String(reader.result));
  reader.readAsText(file, "utf-8");
}

function seededRandom(seed) {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function generateDemoCandles(code, name, seed, startPrice) {
  const random = seededRandom(seed);
  const candles = [];
  let price = startPrice;
  const endDate = new Date();
  endDate.setHours(0, 0, 0, 0);
  for (let i = 0; i < 180; i += 1) {
    const date = new Date(endDate);
    date.setDate(endDate.getDate() - (179 - i));
    const drift = Math.sin(i / 9) * 22 + (random() - 0.5) * startPrice * 0.018;
    const open = price;
    const close = Math.max(10, open + drift);
    const high = Math.max(open, close) + random() * startPrice * 0.01;
    const low = Math.min(open, close) - random() * startPrice * 0.01;
    candles.push({
      date: date.toISOString(),
      open: round(open, 2),
      high: round(high, 2),
      low: round(Math.max(1, low), 2),
      close: round(close, 2),
      volume: Math.round(2000000 + random() * 8000000),
    });
    price = close + (random() - 0.5) * startPrice * 0.006;
  }
  upsertStock({ code, name });
  state.rawCandlesByCode.set(code, candles);
}

function loadDemoData() {
  state.stocks = [];
  state.rawCandlesByCode.clear();
  state.timeframe = "1d";
  timeframeSelect.value = "1d";
  DEFAULT_STOCKS.forEach(upsertStock);
  generateDemoCandles("0050", "元大台灣50", 50, 180);
  generateDemoCandles("2330", "台積電", 2330, 920);
  state.selectedCode = "0050";
  renderAll();
  setStatus("官方資料與站內快取都暫時無法取得，才會改用 0050 / 台積電 示範資料。", "success");
}

function getCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

function detectChartZone(point) {
  const layout = state.chartLayout;
  if (!layout) return "";
  const inBox = (box) => point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;
  if (inBox(layout.priceArea)) return "priceArea";
  if (inBox(layout.xAxisArea)) return "xAxis";
  if (inBox(layout.priceScaleArea)) return "priceScale";
  return "";
}

function updateHoverCrosshair(point) {
  const layout = state.chartLayout;
  if (!layout) {
    state.chartView.hoverX = null;
    return;
  }
  const left = layout.priceArea.x;
  const right = layout.xAxisArea.x + layout.xAxisArea.w;
  const top = layout.priceArea.y;
  const bottom = layout.kdjArea.y + layout.kdjArea.h;
  if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) {
    state.chartView.hoverX = point.x;
  } else {
    state.chartView.hoverX = null;
  }
}

canvas.addEventListener("wheel", (event) => {
  const zone = detectChartZone(getCanvasPoint(event));
  if (!zone) return;
  event.preventDefault();
  const zoomIn = event.deltaY < 0;
  if (zone === "xAxis") state.chartView.visibleCount = clamp(state.chartView.visibleCount + (zoomIn ? -8 : 8), 20, 220);
  if (zone === "priceScale") state.chartView.priceScale = clamp(state.chartView.priceScale + (zoomIn ? -0.1 : 0.1), 0.5, 3);
  renderAll();
}, { passive: false });

canvas.addEventListener("pointermove", (event) => {
  const point = getCanvasPoint(event);
  if (state.dragState) {
    event.preventDefault();
    updateHoverCrosshair(point);
    const dx = point.x - state.dragState.startX;
    const dy = point.y - state.dragState.startY;
    const step = Math.max(6, state.dragState.candleWidth);
    let nextBarOffset = state.dragState.startBarOffset;
    let nextPanX = state.dragState.startPanX + dx;
    while (nextPanX >= step && nextBarOffset < state.dragState.maxBarOffset) {
      nextBarOffset += 1;
      nextPanX -= step;
    }
    while (nextPanX <= -step && nextBarOffset > 0) {
      nextBarOffset -= 1;
      nextPanX += step;
    }
    if (nextBarOffset === 0) nextPanX = Math.max(nextPanX, -step * 0.35);
    if (nextBarOffset === state.dragState.maxBarOffset) nextPanX = Math.min(nextPanX, step * 0.35);
    state.chartView.barOffset = clamp(nextBarOffset, 0, state.dragState.maxBarOffset);
    state.chartView.panX = clamp(nextPanX, -step * 0.95, step * 0.95);
    state.chartView.panY = clamp(state.dragState.startPanY + dy, -state.dragState.priceAreaHeight * 2.2, state.dragState.priceAreaHeight * 2.2);
    canvas.style.cursor = "grabbing";
    renderAll();
    return;
  }
  const zone = detectChartZone(point);
  state.chartView.hoverZone = zone;
  updateHoverCrosshair(point);
  canvas.style.cursor = zone === "xAxis" ? "ew-resize" : zone === "priceScale" ? "ns-resize" : zone === "priceArea" ? "grab" : "default";
  renderAll();
});

canvas.addEventListener("pointerleave", () => {
  if (!state.dragState) {
    state.chartView.hoverZone = "";
    state.chartView.hoverX = null;
    canvas.style.cursor = "default";
    renderAll();
  }
});

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  const point = getCanvasPoint(event);
  const zone = detectChartZone(point);
  if (zone !== "priceArea" || !state.chartLayout) return;
  event.preventDefault();
  const { candles } = getDisplayCandles(state.selectedCode);
  const visibleCount = clamp(state.chartView.visibleCount, 20, Math.min(220, candles.length));
  state.dragState = {
    pointerId: event.pointerId,
    startX: point.x,
    startY: point.y,
    startBarOffset: state.chartView.barOffset,
    startPanX: state.chartView.panX,
    startPanY: state.chartView.panY,
    candleWidth: state.chartLayout.priceArea.w / visibleCount,
    maxBarOffset: Math.max(0, candles.length - visibleCount),
    priceAreaHeight: state.chartLayout.priceArea.h,
  };
  state.chartView.hoverZone = "priceArea";
  canvas.setPointerCapture(event.pointerId);
  canvas.style.cursor = "grabbing";
});

const clearDragState = (event) => {
  if (state.dragState && event?.pointerId != null && state.dragState.pointerId !== event.pointerId) return;
  if (state.dragState && event?.pointerId != null && canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  state.dragState = null;
  canvas.style.cursor = state.chartView.hoverZone === "priceArea" ? "grab" : "default";
};

canvas.addEventListener("pointerup", clearDragState);
canvas.addEventListener("pointercancel", clearDragState);

timeframeSelect.addEventListener("change", () => {
  state.timeframe = timeframeSelect.value;
  resetChartView();
  renderAll();
});

stockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = canonicalizeCode(codeInput.value.trim());
  const name = nameInput.value.trim();
  if (!code) return setStatus("請先輸入股票代號。", "error");
  upsertStock({ code, name: name || code });
  codeInput.value = "";
  nameInput.value = "";
  resetChartView();
  renderAll();
  await ensureStockData(code, name);
});

searchInput.addEventListener("input", renderWatchlist);

watchlistFileInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  readFile(file, (text) => loadWatchlistRows(parseCsv(text)));
  event.target.value = "";
});

priceFileInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  readFile(file, (text) => {
    loadPriceRows(parseCsv(text));
    setStatus("已匯入本地 K 線 CSV。", "success");
  });
  event.target.value = "";
});

window.addEventListener("resize", () => renderAll());

async function bootstrap() {
  initAuthorCardEffects();
  state.stocks = [];
  state.rawCandlesByCode.clear();
  DEFAULT_STOCKS.forEach(upsertStock);
  state.selectedCode = "0050";
  renderAll();
  const [stockOk, indexOk] = await Promise.all([
    ensureStockData("0050", "元大台灣50"),
    ensureStockData("2330", "台積電"),
  ]);
  state.selectedCode = "0050";
  renderAll();
  if (!stockOk && !indexOk) loadDemoData();
}

bootstrap();
