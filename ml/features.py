import json
from typing import Any, Dict

import numpy as np
import pandas as pd


def parse_json_field(value: Any) -> Any:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str) and value.strip():
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return None
    return None


def candle_features(candles: Any, prefix: str) -> Dict[str, Any]:
    data = parse_json_field(candles)
    if not isinstance(data, list) or len(data) == 0:
        return {
            f"{prefix}_count": 0,
            f"{prefix}_ret": 0.0,
            f"{prefix}_volatility": 0.0,
            f"{prefix}_last_close": 0.0,
            f"{prefix}_last_range": 0.0,
        }

    closes = [c.get("close", 0.0) for c in data if isinstance(c, dict)]
    highs = [c.get("high", 0.0) for c in data if isinstance(c, dict)]
    lows = [c.get("low", 0.0) for c in data if isinstance(c, dict)]

    if len(closes) < 2:
        ret = 0.0
        vol = 0.0
    else:
        ret = (closes[-1] - closes[0]) / closes[0] if closes[0] else 0.0
        vol = float(np.std(closes))

    last_close = closes[-1] if closes else 0.0
    last_range = (highs[-1] - lows[-1]) if highs and lows else 0.0

    return {
        f"{prefix}_count": len(closes),
        f"{prefix}_ret": ret,
        f"{prefix}_volatility": vol,
        f"{prefix}_last_close": last_close,
        f"{prefix}_last_range": last_range,
    }


def expand_features(df: pd.DataFrame) -> pd.DataFrame:
    extra_rows = []
    for _, row in df.iterrows():
        features = {}
        features.update(candle_features(row.get("candles"), "candles"))
        features.update(candle_features(row.get("btcCandles"), "btc"))
        strategy_cfg = parse_json_field(row.get("strategyConfig"))
        if isinstance(strategy_cfg, dict):
            for key, value in strategy_cfg.items():
                features[f"strategy_{key}"] = value
        extra_rows.append(features)

    extra_df = pd.DataFrame(extra_rows)
    return pd.concat([df.reset_index(drop=True), extra_df], axis=1)


def drop_raw_columns(df: pd.DataFrame) -> pd.DataFrame:
    drop_cols = [
        "candles",
        "btcCandles",
        "trendLine",
        "strategyConfig",
        "testId",
        "testSuiteId",
        "testName",
    ]
    return df.drop(columns=[c for c in drop_cols if c in df.columns])
