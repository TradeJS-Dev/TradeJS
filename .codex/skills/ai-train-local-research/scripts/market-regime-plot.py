"""Plot existing diagnostic aggregates; no gate reconstruction or model fitting."""
import json
import sys
from datetime import datetime
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as dates

source, panel, output = map(Path, sys.argv[1:4])
report = json.loads(source.read_text())
study = report["marketRegimeDiagnostics"]
raw, frozen = study["streams"]
old, later = frozen["periods"][1:3]
symbols = json.loads(panel.read_text())["streams"][1]["comparisons"][0]["allObservedCommon"]
green, red, gray = "#007f73", "#bf4b45", "#778899"
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 11, "axes.spines.top": False, "axes.spines.right": False})
fig = plt.figure(figsize=(15, 12), layout="constrained")
grid = fig.add_gridspec(3, 2, height_ratios=[1.1, 1, 1])
top = fig.add_subplot(grid[0, :])
for stream, color, label in [(raw, gray, "Весь core"), (frozen, green, "Прежний C")]:
    months = stream["months"]
    x = [datetime.fromisoformat(m["month"] + "-01") for m in months]
    y = [m["metrics"]["completed"]["winRate"] * 100 for m in months]
    top.plot(x, y, color=color, label=label, linewidth=1.6)
    sparse = [(a, b) for a, b, m in zip(x, y, months) if m["metrics"]["completed"]["trades"] < 25]
    if sparse:
        top.scatter(*zip(*sparse), color=color, marker="x", s=35, alpha=.5)
top.axvspan(datetime.fromtimestamp(old["start"] / 1000), datetime.fromtimestamp(old["end"] / 1000), color=green, alpha=.08, label="Ранее удачный период")
top.axhline(42.5, linestyle="--", color=red, label="Около 42,5% — порог безубыточности C")
top.set(title="Доля прибыльных сделок по месяцу сигнала", ylabel="Прибыльные сделки, %", ylim=(0, 100))
top.xaxis.set_major_locator(dates.YearLocator())
top.xaxis.set_major_formatter(dates.DateFormatter("%Y"))
top.set_xlim(datetime.fromtimestamp(frozen["periods"][0]["start"] / 1000), datetime.fromtimestamp(frozen["periods"][0]["end"] / 1000))
top.legend(loc="upper left", ncol=2, fontsize=10)
top.grid(axis="y", alpha=.15)

def comparison(ax, dimension, labels, title):
    a = next(d for d in old["dimensions"] if d["id"] == dimension)
    b = next(d for d in later["dimensions"] if d["id"] == dimension)
    cells = [(x, y) for x, y in zip(a["buckets"], b["buckets"]) if x["metrics"]["completed"]["trades"] and y["metrics"]["completed"]["trades"]]
    indexes = list(range(len(cells)))
    for offset, color, where, legend in [(-.18, green, 0, "04.09.2024–03.03.2025"), (.18, red, 1, "03.03.2025–09.10.2026")]:
        heights = [c[where]["metrics"]["completed"]["winRate"] * 100 for c in cells]
        bars = ax.bar([i + offset for i in indexes], heights, width=.35, color=color, label=legend)
        for bar, c in zip(bars, cells):
            n = c[where]["metrics"]["completed"]["trades"]
            ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + .7, f"N={n}", ha="center", fontsize=9)
    ax.set_xticks(indexes, labels[:len(cells)])
    ax.axhline(42.5, color=gray, linestyle="--")
    ax.set(title=title, ylabel="Прибыльные сделки, %", ylim=(0, 78))
    ax.legend(fontsize=9)
    ax.grid(axis="y", alpha=.15)

comparison(fig.add_subplot(grid[1, 0]), "btc-benchmark-trend", ["BTC: рост MA", "BTC: падение MA"], "Ухудшение есть при обоих направлениях BTC")
comparison(fig.add_subplot(grid[1, 1]), "btc-return24h", ["BTC < −2%", "−2…0%", "0…+2%", "BTC ≥ +2%"], "Дневное движение BTC не объясняет весь регресс")

ax = fig.add_subplot(grid[2, 0])
dimensions = frozen["decompositions"][0]["dimensions"]
chosen = [next(d for d in dimensions if d["id"] == name) for name in ["btc-benchmark-trend", "atr-rank100", "adx-strength", "btc-correlation20"]]
for offset, key, color, label in [(-.18, "mixEffect", gray, "Изменение долей режимов"), (.18, "withinRegimeEffect", red, "Ухудшение внутри режимов")]:
    ax.barh([i + offset for i in range(4)], [d[key] for d in chosen], height=.35, color=color, label=label)
ax.set_yticks(range(4), ["Тренд BTC", "ATR rank", "ADX", "Корреляция BTC"])
ax.set(title="Разложение изменения PnL/сделку\nКаждая строка — отдельное сравнение", xlabel="USDT на сделку")
ax.axvline(0, color=gray)
ax.legend(fontsize=9, loc="lower left")
ax.grid(axis="x", alpha=.15)

ax = fig.add_subplot(grid[2, 1])
values = [symbols["before"]["averageTrade"], symbols["after"]["averageTrade"], symbols["laterAbsentBefore"]["averageTrade"]]
bars = ax.bar(range(3), values, color=[green, red, red], width=.6)
for bar, val in zip(bars, values):
    ax.text(bar.get_x()+bar.get_width()/2, val + (.1 if val >= 0 else -.22), f"{val:+.2f}", ha="center")
ax.set_xticks(range(3), ["Общие символы\nраньше", "Те же символы\nпозже", "Поздние символы\nбез ранних сделок"])
ax.set(title=f"Состав сигналов тоже изменился\nОбщие символы: {symbols['symbols']}", ylabel="PnL/сделку, USDT")
ax.set_ylim(-1.15, 3.55)
ax.axhline(0, color=gray)
ax.grid(axis="y", alpha=.15)
fig.suptitle("VolatilityCompressionBreakout C: почему хороший период не повторился", fontsize=18)
fig.supxlabel("Сделки сгруппированы по времени сигнала; x — месяц с N < 25. История уже исследовалась. Связь с режимом не доказывает причинность.", fontsize=10)
fig.savefig(output, dpi=150)
fig.savefig(output.with_suffix(".svg"))
