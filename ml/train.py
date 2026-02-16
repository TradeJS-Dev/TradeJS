import argparse
import glob
import hashlib
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone
from typing import Iterable, Tuple

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.metrics import classification_report, roc_auc_score, precision_recall_fscore_support
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OrdinalEncoder
from sklearn.ensemble import ExtraTreesClassifier, RandomForestClassifier
from pathlib import Path


def load_dataset(path: str) -> pd.DataFrame:
    if path.endswith('.jsonl'):
        rows = []
        with open(path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                rows.append(json.loads(line))
        return pd.DataFrame(rows)

    if path.endswith('.csv'):
        return pd.read_csv(path)

    raise ValueError('Unsupported input format. Use .csv or .jsonl')


def iter_dataset_chunks(path: str, chunksize: int) -> Iterable[pd.DataFrame]:
    if path.endswith('.csv'):
        yield from pd.read_csv(path, chunksize=chunksize)
        return
    if path.endswith('.jsonl'):
        yield from pd.read_json(path, lines=True, chunksize=chunksize)
        return
    raise ValueError('Unsupported input format. Use .csv or .jsonl')


def prepare_features(df: pd.DataFrame) -> Tuple[pd.DataFrame, pd.Series]:
    df = df.copy()

    df['label'] = df['label'].astype('Int64')
    df = df[df['label'].notna()]

    y = df['label'].astype(int)
    # Keep profit as an output-only column; never use it as a feature.
    X = df.drop(columns=[c for c in ['label', 'signalId', 'profit', 'entryTimestamp'] if c in df.columns])

    return X, y


def align_features(X: pd.DataFrame, expected: list[str]) -> pd.DataFrame:
    if not expected:
        return X
    # Reindex columns in one pass to avoid DataFrame fragmentation from
    # repeated per-column inserts on large chunked datasets.
    return X.reindex(columns=expected, fill_value=0)


def print_threshold_table(y_true: np.ndarray, y_prob: np.ndarray) -> None:
    thresholds = np.round(np.linspace(0.05, 0.95, 19), 2)
    base_rate = float((y_true == 1).mean()) if len(y_true) else 0.0
    pos = int((y_true == 1).sum())
    neg = int((y_true == 0).sum())
    print(f'base_rate={base_rate:.4f} (pos={pos} neg={neg} n={len(y_true)})')
    print('threshold  precision  recall  f1     coverage')
    for row in threshold_rows(y_true, y_prob, thresholds):
        t = row['threshold']
        precision = row['precision']
        recall = row['recall']
        f1 = row['f1']
        coverage = row['coverage']
        print(f'{t:>8.2f}  {precision:>9.3f}  {recall:>6.3f}  {f1:>5.3f}  {coverage:>8.3f}')


def threshold_rows(
    y_true: np.ndarray,
    y_prob: np.ndarray,
    thresholds: np.ndarray | None = None,
    profit: np.ndarray | None = None,
) -> list[dict[str, float]]:
    points = thresholds if thresholds is not None else np.round(np.linspace(0.05, 0.95, 19), 2)
    base_rate = float((y_true == 1).mean()) if len(y_true) else 0.0
    profit_arr = None
    if profit is not None and len(profit) == len(y_true):
        profit_arr = np.asarray(profit, dtype=float)
    rows: list[dict[str, float]] = []
    for t in points:
        preds = (y_prob >= t).astype(int)
        precision, recall, f1, _ = precision_recall_fscore_support(
            y_true, preds, average='binary', zero_division=0
        )
        coverage = float(preds.mean()) if len(preds) else 0.0
        dropped = 1.0 - coverage
        selected_profit = np.nan
        if profit_arr is not None and len(preds):
            mask = preds == 1
            if int(mask.sum()) > 0:
                selected_profit = float(np.nanmean(profit_arr[mask]))
        gain_per_signal = selected_profit if np.isfinite(selected_profit) else (float(precision) - base_rate)
        gain_per_100 = gain_per_signal * coverage * 100.0
        rows.append({
            'threshold': float(t),
            'precision': float(precision),
            'recall': float(recall),
            'f1': float(f1),
            'coverage': float(coverage),
            'dropped': float(dropped),
            'winrate': float(precision),
            'avg_profit_selected': float(selected_profit) if np.isfinite(selected_profit) else float('nan'),
            'gain_per_100': float(gain_per_100),
        })
    return rows


def threshold_markdown_lines(
    y_true: np.ndarray,
    y_prob: np.ndarray,
    profit: np.ndarray | None = None,
) -> list[str]:
    lines = [
        '## Threshold Table',
        '',
        '| threshold | precision | recall | f1 | coverage |',
        '|---:|---:|---:|---:|---:|',
    ]
    for row in threshold_rows(y_true, y_prob, profit=profit):
        lines.append(
            f"| {row['threshold']:.2f} | {row['precision']:.3f} | {row['recall']:.3f} | "
            f"{row['f1']:.3f} | {row['coverage']:.3f} |"
        )
    return lines


def gain_markdown_lines(
    y_true: np.ndarray,
    y_prob: np.ndarray,
    profit: np.ndarray | None = None,
) -> list[str]:
    lines = [
        '## Gain By Threshold',
        '',
        '| threshold | winrate | % dropped | avg_profit_selected | gain_per_100 |',
        '|---:|---:|---:|---:|---:|',
    ]
    for row in threshold_rows(y_true, y_prob, profit=profit):
        avg_profit = row['avg_profit_selected']
        avg_profit_txt = f'{avg_profit:.4f}' if np.isfinite(avg_profit) else 'n/a'
        lines.append(
            f"| {row['threshold']:.2f} | {row['winrate']:.3f} | {row['dropped'] * 100:.1f}% | "
            f"{avg_profit_txt} | {row['gain_per_100']:.3f} |"
        )
    return lines


def regime_threshold_policy(
    y_true: np.ndarray,
    y_prob: np.ndarray,
    regime_high_vol: np.ndarray | None = None,
    profit: np.ndarray | None = None,
) -> list[dict[str, float | str]]:
    rows = threshold_rows(y_true, y_prob, profit=profit)
    eligible = [row for row in rows if row['coverage'] >= 0.05]
    if not eligible:
        return []

    def best_row(subset: list[dict[str, float]]) -> dict[str, float]:
        if not subset:
            return max(eligible, key=lambda row: row['gain_per_100'])
        return max(subset, key=lambda row: row['gain_per_100'])

    output: list[dict[str, float | str]] = [{
        'regime': 'all',
        **best_row(eligible),
    }]
    if regime_high_vol is None or len(regime_high_vol) != len(y_true):
        return output

    high_mask = regime_high_vol.astype(bool)
    low_mask = ~high_mask
    for regime_name, mask in [('high_vol', high_mask), ('low_vol', low_mask)]:
        if int(mask.sum()) < 50:
            continue
        regime_rows = threshold_rows(y_true[mask], y_prob[mask], profit=(profit[mask] if profit is not None else None))
        regime_eligible = [row for row in regime_rows if row['coverage'] >= 0.05]
        if not regime_eligible:
            continue
        output.append({
            'regime': regime_name,
            **best_row(regime_eligible),
        })
    return output


def policy_markdown_lines(
    y_true: np.ndarray,
    y_prob: np.ndarray,
    regime_high_vol: np.ndarray | None = None,
    profit: np.ndarray | None = None,
) -> list[str]:
    policy = regime_threshold_policy(
        y_true=y_true,
        y_prob=y_prob,
        regime_high_vol=regime_high_vol,
        profit=profit,
    )
    lines = [
        '## Threshold Policy',
        '',
        '| regime | threshold | winrate | coverage | gain_per_100 |',
        '|---|---:|---:|---:|---:|',
    ]
    if not policy:
        lines.append('| n/a | n/a | n/a | n/a | n/a |')
        return lines
    for item in policy:
        lines.append(
            f"| {item['regime']} | {item['threshold']:.2f} | {item['winrate']:.3f} | "
            f"{item['coverage']:.3f} | {item['gain_per_100']:.3f} |"
        )
    return lines


def walk_forward_markdown_lines(
    rows: list[dict[str, object]],
) -> list[str]:
    lines = [
        '## Walk-forward Holdouts',
        '',
        '| fold | train_rows | test_rows | ensemble_members_used | auc | window_start_utc | window_end_utc |',
        '|---:|---:|---:|---:|---:|---|---|',
    ]
    if not rows:
        lines.append('| n/a | n/a | n/a | n/a | n/a | n/a | n/a |')
        return lines
    for row in rows:
        start_ts = float(row.get('start_ts', float('nan')))
        end_ts = float(row.get('end_ts', float('nan')))
        auc = float(row.get('auc', float('nan')))
        members_used = int(float(row.get('ensemble_members', 1)))
        start_dt = datetime.fromtimestamp(start_ts / 1000, tz=timezone.utc).isoformat() if np.isfinite(start_ts) else 'n/a'
        end_dt = datetime.fromtimestamp(end_ts / 1000, tz=timezone.utc).isoformat() if np.isfinite(end_ts) else 'n/a'
        auc_txt = f"{auc:.6f}" if np.isfinite(auc) else 'n/a'
        lines.append(
            f"| {int(float(row.get('fold', 0)))} | {int(float(row.get('train_rows', 0)))} | {int(float(row.get('test_rows', 0)))} | {members_used} | "
            f"{auc_txt} | {start_dt} | {end_dt} |"
        )
    return lines


def walk_forward_threshold_markdown_lines(
    rows: list[dict[str, object]],
) -> list[str]:
    lines = ['## Walk-forward Threshold Tables', '']
    if not rows:
        lines.append('n/a')
        return lines
    for row in rows:
        fold = int(float(row.get('fold', 0)))
        fold_threshold_rows = row.get('threshold_rows')
        lines += [
            f'### Fold {fold}',
            '',
            '| threshold | precision | recall | f1 | coverage |',
            '|---:|---:|---:|---:|---:|',
        ]
        if not isinstance(fold_threshold_rows, list) or not fold_threshold_rows:
            lines.append('| n/a | n/a | n/a | n/a | n/a |')
            lines.append('')
            continue
        for item in fold_threshold_rows:
            if not isinstance(item, dict):
                continue
            threshold = float(item.get('threshold', float('nan')))
            precision = float(item.get('precision', float('nan')))
            recall = float(item.get('recall', float('nan')))
            f1 = float(item.get('f1', float('nan')))
            coverage = float(item.get('coverage', float('nan')))
            lines.append(
                f"| {threshold:.2f} | {precision:.3f} | {recall:.3f} | {f1:.3f} | {coverage:.3f} |"
            )
        lines.append('')
    return lines


def _fmt_ts_ms_utc(ts_ms: int | float | None) -> str:
    if ts_ms is None:
        return 'n/a'
    try:
        return datetime.fromtimestamp(float(ts_ms) / 1000.0, tz=timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
    except (ValueError, OverflowError, OSError):
        return 'n/a'


def _labeled_time_bounds_ms(df: pd.DataFrame) -> tuple[int | None, int | None]:
    if 'entryTimestamp' not in df.columns or 'label' not in df.columns:
        return None, None
    labeled = df[df['label'].notna()]
    if labeled.empty:
        return None, None
    ts = _to_epoch_ms(_to_entry_timestamp(labeled))
    if ts.empty:
        return None, None
    ts_dt = pd.to_datetime(ts, unit='ms', utc=True, errors='coerce')
    ts_dt = ts_dt.dropna()
    if ts_dt.empty:
        return None, None
    start_ms = int(ts_dt.min().timestamp() * 1000)
    end_ms = int(ts_dt.max().timestamp() * 1000)
    return start_ms, end_ms


def _days_span(start_ms: int | None, end_ms: int | None) -> str:
    if start_ms is None or end_ms is None:
        return 'n/a'
    days = (float(end_ms) - float(start_ms)) / (1000.0 * 60 * 60 * 24)
    return f'{days:.1f}'


def evaluation_windows_markdown_lines(
    train_df: pd.DataFrame,
    test_df: pd.DataFrame,
    train_rows: int,
    test_rows: int,
    walk_forward_rows: list[dict[str, object]],
) -> list[str]:
    train_start, train_end = _labeled_time_bounds_ms(train_df)
    test_start, test_end = _labeled_time_bounds_ms(test_df)
    lines = [
        '## Evaluation Windows',
        '',
        '| test | train_start_utc | train_end_utc | train_days | train_rows | test_start_utc | test_end_utc | test_days | test_rows |',
        '|---|---|---|---:|---:|---|---|---:|---:|',
        (
            f"| Main holdout | {_fmt_ts_ms_utc(train_start)} | {_fmt_ts_ms_utc(train_end)} | "
            f"{_days_span(train_start, train_end)} | {int(train_rows)} | "
            f"{_fmt_ts_ms_utc(test_start)} | {_fmt_ts_ms_utc(test_end)} | "
            f"{_days_span(test_start, test_end)} | {int(test_rows)} |"
        ),
    ]
    for row in walk_forward_rows:
        fold = int(row.get('fold', 0))
        tr_start = int(row['train_start_ts']) if np.isfinite(row.get('train_start_ts', np.nan)) else None
        tr_end = int(row['train_end_ts']) if np.isfinite(row.get('train_end_ts', np.nan)) else None
        te_start = int(row['test_start_ts']) if np.isfinite(row.get('test_start_ts', np.nan)) else None
        te_end = int(row['test_end_ts']) if np.isfinite(row.get('test_end_ts', np.nan)) else None
        tr_rows = int(row.get('train_rows', 0))
        te_rows = int(row.get('test_rows', 0))
        lines.append(
            f"| Walk-forward fold {fold} | {_fmt_ts_ms_utc(tr_start)} | {_fmt_ts_ms_utc(tr_end)} | "
            f"{_days_span(tr_start, tr_end)} | {tr_rows} | "
            f"{_fmt_ts_ms_utc(te_start)} | {_fmt_ts_ms_utc(te_end)} | "
            f"{_days_span(te_start, te_end)} | {te_rows} |"
        )
    return lines


def print_evaluation_windows_summary(
    train_df: pd.DataFrame,
    test_df: pd.DataFrame,
    train_rows: int,
    test_rows: int,
    walk_forward_rows: list[dict[str, object]],
) -> None:
    train_start, train_end = _labeled_time_bounds_ms(train_df)
    test_start, test_end = _labeled_time_bounds_ms(test_df)
    print('Evaluation windows:')
    print(
        'Main holdout:\n'
        f'  train: {_fmt_ts_ms_utc(train_start)} -> {_fmt_ts_ms_utc(train_end)} '
        f'({_days_span(train_start, train_end)}d, rows={int(train_rows)})\n'
        f'  test : {_fmt_ts_ms_utc(test_start)} -> {_fmt_ts_ms_utc(test_end)} '
        f'({_days_span(test_start, test_end)}d, rows={int(test_rows)})'
    )
    for row in walk_forward_rows:
        fold = int(row.get('fold', 0))
        tr_start = int(row['train_start_ts']) if np.isfinite(row.get('train_start_ts', np.nan)) else None
        tr_end = int(row['train_end_ts']) if np.isfinite(row.get('train_end_ts', np.nan)) else None
        te_start = int(row['test_start_ts']) if np.isfinite(row.get('test_start_ts', np.nan)) else None
        te_end = int(row['test_end_ts']) if np.isfinite(row.get('test_end_ts', np.nan)) else None
        tr_rows = int(row.get('train_rows', 0))
        te_rows = int(row.get('test_rows', 0))
        print(
            f'Walk-forward fold {fold}:\n'
            f'  train: {_fmt_ts_ms_utc(tr_start)} -> {_fmt_ts_ms_utc(tr_end)} '
            f'({_days_span(tr_start, tr_end)}d, rows={tr_rows})\n'
            f'  test : {_fmt_ts_ms_utc(te_start)} -> {_fmt_ts_ms_utc(te_end)} '
            f'({_days_span(te_start, te_end)}d, rows={te_rows})'
        )


def infer_ts_unit(ts: pd.Series) -> str:
    max_val = int(ts.max())
    # 10^12+ is typically epoch milliseconds, otherwise seconds.
    return 'ms' if max_val >= 10**12 else 's'


def split_last_days(df: pd.DataFrame, days: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    if 'entryTimestamp' not in df.columns:
        raise SystemExit('entryTimestamp is required for time-based split.')

    labeled = df[df['label'].notna()].copy()
    if labeled.empty:
        raise SystemExit('No labeled rows available for time-based split.')

    ts = labeled['entryTimestamp'].astype('Int64')
    if ts.isna().all():
        raise SystemExit('entryTimestamp is missing or invalid for time-based split.')

    unit = infer_ts_unit(ts.dropna())
    ts_dt = pd.to_datetime(ts, unit=unit, utc=True, errors='coerce')
    if ts_dt.isna().all():
        raise SystemExit('Failed to parse entryTimestamp for time-based split.')

    max_dt = ts_dt.max()
    cutoff = max_dt - pd.Timedelta(days=days)
    test_mask = ts_dt > cutoff
    test_count = int(test_mask.sum())
    train_count = int((~test_mask).sum())

    if test_count == 0 or train_count == 0:
        raise SystemExit(
            f'Time split failed (train={train_count}, test={test_count}). '
            f'Adjust --test-days or verify entryTimestamp.'
        )

    print(
        f'Time split: train={train_count}, test={test_count}, '
        f'test window=({cutoff.isoformat()} .. {max_dt.isoformat()}]'
    )
    return labeled.loc[~test_mask].copy(), labeled.loc[test_mask].copy()


def keep_recent_days(df: pd.DataFrame, days: int) -> pd.DataFrame:
    if days <= 0:
        return df
    if 'entryTimestamp' not in df.columns:
        return df
    ts = df['entryTimestamp'].astype('Int64')
    if ts.isna().all():
        return df
    unit = infer_ts_unit(ts.dropna())
    ts_dt = pd.to_datetime(ts, unit=unit, utc=True, errors='coerce')
    if ts_dt.isna().all():
        return df
    max_dt = ts_dt.max()
    cutoff = max_dt - pd.Timedelta(days=days)
    return df.loc[ts_dt >= cutoff].copy()


def apply_feature_set(X: pd.DataFrame, feature_set: str) -> pd.DataFrame:
    if feature_set != 'legacy':
        return X
    drop_prefixes = ('Ctx_', 'Regime_', 'XS_')
    keep_cols = [col for col in X.columns if not col.startswith(drop_prefixes)]
    dropped = len(X.columns) - len(keep_cols)
    if dropped > 0:
        print(f'Feature set=legacy: dropped {dropped} enriched columns')
    return X[keep_cols].copy()


def select_robust_feature_columns(X_train: pd.DataFrame) -> list[str]:
    selected: list[str] = []
    dropped_noisy = 0
    dropped_sparse = 0

    for col in X_train.columns:
        # These families were unstable across market regimes in holdout checks.
        if 'OBV_LogRet' in col or col.startswith('TrendLine_Alpha_'):
            dropped_noisy += 1
            continue

        series = X_train[col]
        if pd.api.types.is_numeric_dtype(series):
            numeric = pd.to_numeric(series, errors='coerce')
            unique = int(numeric.nunique(dropna=True))
            non_na = numeric.dropna()
            uniq_vals = set(non_na.unique().tolist())
            is_binary = bool(uniq_vals) and uniq_vals.issubset({0, 1})

            # Keep informative binary flags (0/1, bool-like) in robust mode.
            # They often encode regime/context gates and should not be dropped
            # just because they have low cardinality.
            if is_binary:
                if unique <= 1:
                    dropped_sparse += 1
                    continue
                selected.append(col)
                continue

            if unique <= 3:
                dropped_sparse += 1
                continue
            zero_rate = float((numeric.fillna(0) == 0).mean())
            if zero_rate > 0.98:
                dropped_sparse += 1
                continue

        selected.append(col)

    print(
        f'Feature profile=robust: {len(X_train.columns)} -> {len(selected)} '
        f'(drop_noisy={dropped_noisy}, drop_sparse={dropped_sparse})'
    )
    return selected


def build_model(model_type: str):
    if model_type == 'catboost':
        try:
            from catboost import CatBoostClassifier  # type: ignore
        except ImportError as exc:
            raise SystemExit(
                "catboost is not installed. Add it to ml/requirements.txt or use --model-type random_forest."
            ) from exc
        return CatBoostClassifier(
            iterations=300,
            depth=4,
            learning_rate=0.05,
            random_seed=42,
            loss_function='Logloss',
            eval_metric='AUC',
            l2_leaf_reg=3,
            verbose=False,
            used_ram_limit='14gb',
        )

    if model_type == 'random_forest':
        return RandomForestClassifier(
            n_estimators=120,
            max_depth=14,
            min_samples_leaf=10,
            max_features='sqrt',
            n_jobs=1,
            random_state=42,
            class_weight='balanced_subsample',
        )

    if model_type == 'extra_trees':
        return ExtraTreesClassifier(
            n_estimators=240,
            max_depth=14,
            min_samples_leaf=8,
            max_features='sqrt',
            n_jobs=1,
            random_state=42,
            class_weight='balanced',
        )

    if model_type == 'xgboost':
        try:
            from xgboost import XGBClassifier  # type: ignore
        except ImportError as exc:
            raise SystemExit(
                "xgboost is not installed. Add it to ml/requirements.txt or use another --model-type."
            ) from exc
        return XGBClassifier(
            n_estimators=400,
            max_depth=5,
            learning_rate=0.05,
            subsample=0.9,
            colsample_bytree=0.9,
            reg_lambda=1.0,
            random_state=42,
            n_jobs=1,
            eval_metric='logloss',
        )

    if model_type == 'lightgbm':
        try:
            from lightgbm import LGBMClassifier  # type: ignore
        except ImportError as exc:
            raise SystemExit(
                "lightgbm is not installed. Add it to ml/requirements.txt or use another --model-type."
            ) from exc
        return LGBMClassifier(
            n_estimators=400,
            max_depth=-1,
            num_leaves=31,
            learning_rate=0.05,
            subsample=0.9,
            colsample_bytree=0.9,
            reg_lambda=1.0,
            random_state=42,
            n_jobs=1,
        )

    raise ValueError(f'Unsupported model type: {model_type}')


def build_pipeline(X: pd.DataFrame, model_type: str) -> Pipeline:
    if model_type == 'catboost':
        # CatBoost handles categorical features natively; OHE massively inflates memory.
        return Pipeline(
            steps=[
                ('preprocess', 'passthrough'),
                ('model', build_model(model_type)),
            ]
        )

    categorical = [
        c
        for c in X.columns
        if (X[c].dtype == 'object' or str(X[c].dtype) == 'category')
        and c not in ('strategyConfig',)
    ]
    numeric = [c for c in X.columns if c not in categorical]

    preprocessor = ColumnTransformer(
        transformers=[
            # Ordinal encoding avoids OHE dimensional explosion on wide categorical spaces.
            ('cat', OrdinalEncoder(handle_unknown='use_encoded_value', unknown_value=-1), categorical),
            ('num', 'passthrough', numeric),
        ],
    )

    model = build_model(model_type)

    return Pipeline(
        steps=[
            ('preprocess', preprocessor),
            ('model', model),
        ]
    )


def fit_pipeline(pipeline: Pipeline, X: pd.DataFrame, y: pd.Series, model_type: str) -> None:
    if model_type == 'catboost':
        cat_features = [
            idx
            for idx, col in enumerate(X.columns)
            if X[col].dtype == 'object' or str(X[col].dtype) == 'category'
        ]
        pipeline.fit(X, y, model__cat_features=cat_features)
        return
    pipeline.fit(X, y)


def compute_ensemble_cutoffs(source_df: pd.DataFrame, members: int = 2) -> list[int]:
    if members < 2:
        raise SystemExit('--ensemble-members must be >= 2 when --ensemble is enabled.')
    ts = source_df['entryTimestamp'].astype('Int64')
    if ts.isna().all():
        raise SystemExit('entryTimestamp is missing or invalid for ensemble training.')
    ts_values = ts.dropna().astype(int).to_numpy()
    probs = np.linspace(1 / members, 1.0, members)
    quantiles = np.quantile(ts_values, probs)
    return [int(q) for q in quantiles]


def archive_with_date_suffix(path: str, date_suffix: str) -> str:
    root, ext = os.path.splitext(path)
    candidate = f'{root}.{date_suffix}{ext}'
    if not os.path.exists(candidate):
        os.replace(path, candidate)
        return candidate

    idx = 1
    while True:
        candidate = f'{root}.{date_suffix}.{idx}{ext}'
        if not os.path.exists(candidate):
            os.replace(path, candidate)
            return candidate
        idx += 1


def clear_strategy_models(model_base: str) -> None:
    date_suffix = datetime.now(timezone.utc).strftime('%Y%m%d')
    archived: list[str] = []
    existing_paths: set[str] = set()
    parent = os.path.dirname(model_base) or '.'
    base = os.path.basename(model_base)
    active_patterns = [
        re.compile(rf'^{re.escape(base)}\.joblib$'),
        re.compile(rf'^{re.escape(base)}\.model\d+\.joblib$'),
    ]
    try:
        for name in os.listdir(parent):
            if any(pattern.match(name) for pattern in active_patterns):
                existing_paths.add(os.path.join(parent, name))
    except FileNotFoundError:
        pass

    for path in sorted(existing_paths):
        archived_path = archive_with_date_suffix(path, date_suffix)
        archived.append(archived_path)

    for path in archived:
        print('Archived previous model:', path)


def model_base_from_arg(model_arg: str, strategy: str) -> str:
    value = model_arg or f'data/ml/models/{strategy}'
    return value[:-7] if value.endswith('.joblib') else value


def ensure_parent_dir(path: str) -> None:
    parent = os.path.dirname(path) or '.'
    os.makedirs(parent, exist_ok=True)


def utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')


def write_training_notes(path: str, lines: list[str]) -> None:
    ensure_parent_dir(path)
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines).rstrip() + '\n')


def compute_binary_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, float]:
    tp = int(((y_true == 1) & (y_pred == 1)).sum())
    tn = int(((y_true == 0) & (y_pred == 0)).sum())
    fp = int(((y_true == 0) & (y_pred == 1)).sum())
    fn = int(((y_true == 1) & (y_pred == 0)).sum())
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    accuracy = (tp + tn) / max(tp + tn + fp + fn, 1)
    return {
        'tp': float(tp),
        'tn': float(tn),
        'fp': float(fp),
        'fn': float(fn),
        'precision': precision,
        'recall': recall,
        'f1': f1,
        'accuracy': accuracy,
    }


def select_report_columns(X: pd.DataFrame, limit: int = 25) -> list[str]:
    candidates: list[tuple[float, str]] = []
    for col in X.columns:
        series = X[col]
        if pd.api.types.is_numeric_dtype(series):
            variance = float(pd.to_numeric(series, errors='coerce').var())
            if np.isfinite(variance):
                candidates.append((variance, col))
        else:
            # Keep categorical context columns if present.
            if col in ('symbol', 'strategy', 'direction'):
                candidates.append((1e12, col))
    candidates.sort(reverse=True)
    selected = [col for _var, col in candidates[:limit]]
    return selected


def ensure_report_dir(path: str) -> None:
    Path(path).mkdir(parents=True, exist_ok=True)


def append_html_section(path: str, section_html: str) -> None:
    try:
        with open(path, 'r', encoding='utf-8') as f:
            html = f.read()
        if '</body>' in html:
            html = html.replace('</body>', f'{section_html}\n</body>', 1)
        else:
            html = html + section_html
        with open(path, 'w', encoding='utf-8') as f:
            f.write(html)
    except Exception as exc:  # noqa: BLE001
        print(f'Warning: failed to append custom HTML section: {exc}')


def threshold_policy_html(
    y_true: np.ndarray,
    y_prob: np.ndarray,
    profit: np.ndarray | None = None,
    regime_high_vol: np.ndarray | None = None,
) -> str:
    rows = threshold_rows(y_true, y_prob, profit=profit)
    policy = regime_threshold_policy(y_true, y_prob, regime_high_vol=regime_high_vol, profit=profit)
    lines = [
        '<section style="padding: 20px 24px; font-family: -apple-system, sans-serif;">',
        '<h2>Gain By Threshold</h2>',
        '<table border="1" cellspacing="0" cellpadding="6">',
        '<tr><th>threshold</th><th>winrate</th><th>coverage</th><th>dropped%</th><th>avg_profit_selected</th><th>gain_per_100</th></tr>',
    ]
    for row in rows:
        avg_profit = row['avg_profit_selected']
        avg_txt = f"{avg_profit:.4f}" if np.isfinite(avg_profit) else 'n/a'
        lines.append(
            f"<tr><td>{row['threshold']:.2f}</td><td>{row['winrate']:.3f}</td><td>{row['coverage']:.3f}</td>"
            f"<td>{row['dropped'] * 100:.1f}%</td><td>{avg_txt}</td><td>{row['gain_per_100']:.3f}</td></tr>"
        )
    lines.append('</table>')
    if policy:
        lines.append('<h3 style="margin-top:16px;">Recommended Threshold Policy</h3>')
        lines.append('<table border="1" cellspacing="0" cellpadding="6">')
        lines.append('<tr><th>regime</th><th>threshold</th><th>winrate</th><th>coverage</th><th>gain_per_100</th></tr>')
        for item in policy:
            lines.append(
                f"<tr><td>{item['regime']}</td><td>{item['threshold']:.2f}</td><td>{item['winrate']:.3f}</td>"
                f"<td>{item['coverage']:.3f}</td><td>{item['gain_per_100']:.3f}</td></tr>"
            )
        lines.append('</table>')
    lines.append('</section>')
    return '\n'.join(lines)


def create_training_html_report(
    report_dir: str,
    strategy: str,
    model_type: str,
    y_true: np.ndarray,
    y_prob: np.ndarray,
    X_eval: pd.DataFrame | None = None,
    extra: dict | None = None,
    out_path: str | None = None,
    profit: np.ndarray | None = None,
    regime_high_vol: np.ndarray | None = None,
) -> str | None:
    ensure_report_dir(report_dir)
    if out_path is None:
        ts = utc_stamp()
        out_path = os.path.join(report_dir, f'{strategy}.train-report.{ts}.html')
    else:
        ensure_parent_dir(out_path)
    report_df = pd.DataFrame({
        'y_true': y_true.astype(int),
        'y_prob': y_prob.astype(float),
        'y_pred': (y_prob >= 0.5).astype(int),
    })
    if X_eval is not None and not X_eval.empty:
        keep = select_report_columns(X_eval, limit=20)
        report_df = pd.concat(
            [report_df, X_eval[keep].reset_index(drop=True)],
            axis=1,
        )
    if extra:
        for key, value in extra.items():
            report_df[key] = value

    try:
        from ydata_profiling import ProfileReport  # type: ignore

        profile = ProfileReport(
            report_df,
            title=f'ML Training Report: {strategy} ({model_type})',
            minimal=True,
            progress_bar=False,
        )
        profile.to_file(out_path)
        append_html_section(
            out_path,
            threshold_policy_html(
                y_true=y_true,
                y_prob=y_prob,
                profit=profit,
                regime_high_vol=regime_high_vol,
            ),
        )
        print(f'Training HTML report saved: {out_path}')
        return out_path
    except Exception as exc:  # noqa: BLE001
        print(f'Warning: failed to generate HTML report: {exc}')
        return None


def _default_walk_forward_spec_path(
    report_dir: str,
    strategy: str,
    input_path: str,
    test_input_path: str,
    folds: int,
    test_days: int,
) -> str:
    src = f'{Path(input_path).name}|{Path(test_input_path).name if test_input_path else "self"}|{folds}|{test_days}'
    digest = hashlib.sha1(src.encode('utf-8')).hexdigest()[:12]
    out_dir = Path(report_dir) / 'walk-forward'
    out_dir.mkdir(parents=True, exist_ok=True)
    return str(out_dir / f'{strategy}.{digest}.windows.json')


def _to_entry_timestamp(df: pd.DataFrame) -> pd.Series:
    if 'entryTimestamp' not in df.columns:
        return pd.Series([], dtype='Int64')
    return pd.to_numeric(df['entryTimestamp'], errors='coerce').astype('Int64')


def _to_epoch_ms(ts: pd.Series) -> pd.Series:
    cleaned = pd.to_numeric(ts, errors='coerce').dropna().astype('int64')
    if cleaned.empty:
        return cleaned
    unit = infer_ts_unit(cleaned)
    if unit == 'ms':
        return cleaned
    return cleaned * 1000


def _build_or_load_walk_forward_windows(
    source_df: pd.DataFrame,
    folds: int,
    test_days: int,
    spec_path: str,
) -> list[dict[str, int]]:
    if folds <= 0:
        return []
    ts = _to_entry_timestamp(source_df)
    if ts.empty or ts.isna().all():
        return []
    valid_ts = ts.dropna().astype(int)
    unit = infer_ts_unit(valid_ts)
    dt = pd.to_datetime(valid_ts, unit=unit, utc=True, errors='coerce')
    if dt.isna().all():
        return []
    max_dt = dt.max()
    windows: list[dict[str, int]] = []
    for idx in range(folds):
        end_dt = max_dt - pd.Timedelta(days=idx * test_days)
        start_dt = end_dt - pd.Timedelta(days=test_days)
        windows.append(
            {
                'fold': idx + 1,
                'start_ts': int(start_dt.timestamp() * 1000),
                'end_ts': int(end_dt.timestamp() * 1000),
            }
        )

    spec_file = Path(spec_path)
    spec_file.parent.mkdir(parents=True, exist_ok=True)
    if spec_file.exists():
        with open(spec_file, 'r', encoding='utf-8') as f:
            payload = json.load(f)
        loaded = payload.get('windows', [])
        if isinstance(loaded, list) and loaded:
            return [
                {
                    'fold': int(item['fold']),
                    'start_ts': int(item['start_ts']),
                    'end_ts': int(item['end_ts']),
                }
                for item in loaded
            ]

    payload = {
        'folds': folds,
        'test_days': test_days,
        'windows': windows,
    }
    with open(spec_file, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    return windows


def run_walk_forward_validation(
    source_df: pd.DataFrame,
    model_type: str,
    folds: int,
    test_days: int,
    train_recent_days: int,
    spec_path: str,
    selected_features: list[str] | None = None,
    ensemble: bool = False,
    ensemble_members: int = 2,
) -> tuple[list[float], list[dict[str, object]], str]:
    if folds <= 0:
        return [], [], spec_path
    if 'entryTimestamp' not in source_df.columns:
        print('Walk-forward skipped: no entryTimestamp in source data.')
        return [], [], spec_path

    ordered = source_df[source_df['label'].notna()].copy()
    if ordered.empty:
        print('Walk-forward skipped: no labeled rows in source data.')
        return [], [], spec_path
    ts = _to_entry_timestamp(ordered)
    ordered = ordered[ts.notna()].copy()
    if ordered.empty:
        print('Walk-forward skipped: no valid entryTimestamp.')
        return [], [], spec_path
    ordered['entryTimestamp'] = pd.to_numeric(
        ordered['entryTimestamp'],
        errors='coerce',
    ).astype('int64')
    ordered = ordered.sort_values('entryTimestamp').reset_index(drop=True)

    windows = _build_or_load_walk_forward_windows(
        source_df=ordered,
        folds=folds,
        test_days=test_days,
        spec_path=spec_path,
    )
    fold_scores: list[float] = []
    fold_rows: list[dict[str, object]] = []
    ts_values = ordered['entryTimestamp']
    for window in windows:
        fold = int(window['fold'])
        start_ts = int(window['start_ts'])
        end_ts = int(window['end_ts'])
        val_mask = (ts_values > start_ts) & (ts_values <= end_ts)
        fold_val = ordered.loc[val_mask].copy()
        fold_train = ordered.loc[ts_values <= start_ts].copy()
        if train_recent_days > 0:
            fold_train = keep_recent_days(fold_train, train_recent_days)
        if fold_train.empty or fold_val.empty:
            continue

        X_tr, y_tr = prepare_features(fold_train)
        X_val, y_val = prepare_features(fold_val)
        if X_tr.empty or X_val.empty:
            continue
        if selected_features:
            X_tr = align_features(X_tr, selected_features)
            X_val = align_features(X_val, selected_features)

        if ensemble:
            ts_fold = fold_train['entryTimestamp'].astype('Int64')
            cutoffs = compute_ensemble_cutoffs(fold_train, members=ensemble_members)
            probs_per_model: list[np.ndarray] = []
            used_members = 0
            for cutoff in cutoffs:
                member_mask = ts_fold <= cutoff
                member_df = fold_train.loc[member_mask].copy()
                if member_df.empty:
                    continue
                X_member, y_member = prepare_features(member_df)
                if X_member.empty:
                    continue
                if y_member.nunique() < 2:
                    continue
                if selected_features:
                    X_member = align_features(X_member, selected_features)
                member_pipeline = build_pipeline(X_member, model_type)
                fit_pipeline(member_pipeline, X_member, y_member, model_type)
                preprocess = member_pipeline.named_steps.get('preprocess')
                expected = list(getattr(preprocess, 'feature_names_in_', []))
                X_eval = align_features(X_val, expected) if expected else X_val
                probs_per_model.append(member_pipeline.predict_proba(X_eval)[:, 1])
                used_members += 1

            if not probs_per_model:
                continue
            y_prob = np.mean(np.vstack(probs_per_model), axis=0)
        else:
            pipeline = build_pipeline(X_tr, model_type)
            fit_pipeline(pipeline, X_tr, y_tr, model_type)
            preprocess = pipeline.named_steps.get('preprocess')
            expected = list(getattr(preprocess, 'feature_names_in_', []))
            X_eval = align_features(X_val, expected) if expected else X_val
            y_prob = pipeline.predict_proba(X_eval)[:, 1]
            used_members = 1
        fold_thresholds = threshold_rows(y_val.to_numpy(), y_prob)
        try:
            auc = float(roc_auc_score(y_val, y_prob))
        except ValueError:
            auc = float('nan')
        fold_scores.append(auc)
        tr_ts = _to_epoch_ms(_to_entry_timestamp(fold_train))
        te_ts = _to_epoch_ms(_to_entry_timestamp(fold_val))
        fold_row = {
            'fold': float(fold),
            'train_rows': float(len(y_tr)),
            'test_rows': float(len(y_val)),
            'auc': auc,
            'start_ts': float(start_ts),
            'end_ts': float(end_ts),
            'train_start_ts': float(tr_ts.min()) if not tr_ts.empty else float('nan'),
            'train_end_ts': float(tr_ts.max()) if not tr_ts.empty else float('nan'),
            'test_start_ts': float(te_ts.min()) if not te_ts.empty else float('nan'),
            'test_end_ts': float(te_ts.max()) if not te_ts.empty else float('nan'),
            'threshold_rows': fold_thresholds,
            'ensemble_members': float(used_members),
        }
        fold_rows.append(fold_row)
        print(
            f'Walk-forward holdout {fold}/{folds}: '
            f'train={len(y_tr)} val={len(y_val)} auc={auc:.4f} members={used_members}'
        )
        print(f'Walk-forward fold {fold}/{folds} threshold table:')
        print_threshold_table(y_val.to_numpy(), y_prob)

    valid = [score for score in fold_scores if np.isfinite(score)]
    if valid:
        print(
            f'Walk-forward AUC mean={np.mean(valid):.4f} std={np.std(valid):.4f} '
            f'({len(valid)} folds)'
        )
    return valid, fold_rows, spec_path


def run_walk_forward_validation_from_files(
    train_inputs: list[str],
    test_inputs: list[str],
    model_type: str,
    train_recent_days: int,
    selected_features: list[str] | None = None,
    ensemble: bool = False,
    ensemble_members: int = 2,
) -> tuple[list[float], list[dict[str, object]], str]:
    if not train_inputs and not test_inputs:
        return [], [], 'external-fold-files'
    if len(train_inputs) != len(test_inputs):
        raise SystemExit(
            'Walk-forward fold inputs mismatch: '
            f'train={len(train_inputs)} test={len(test_inputs)}'
        )

    fold_scores: list[float] = []
    fold_rows: list[dict[str, object]] = []
    total_folds = len(train_inputs)
    for idx, (train_path, test_path) in enumerate(zip(train_inputs, test_inputs), start=1):
        fold = idx
        fold_train = load_dataset(train_path)
        fold_train = fold_train[fold_train['label'].notna()].copy()
        fold_val = load_dataset(test_path)
        fold_val = fold_val[fold_val['label'].notna()].copy()

        if train_recent_days > 0:
            fold_train = keep_recent_days(fold_train, train_recent_days)
        if fold_train.empty or fold_val.empty:
            continue

        X_tr, y_tr = prepare_features(fold_train)
        X_val, y_val = prepare_features(fold_val)
        if X_tr.empty or X_val.empty:
            continue
        if selected_features:
            X_tr = align_features(X_tr, selected_features)
            X_val = align_features(X_val, selected_features)

        if ensemble:
            ts_fold = fold_train['entryTimestamp'].astype('Int64')
            cutoffs = compute_ensemble_cutoffs(fold_train, members=ensemble_members)
            probs_per_model: list[np.ndarray] = []
            used_members = 0
            for cutoff in cutoffs:
                member_mask = ts_fold <= cutoff
                member_df = fold_train.loc[member_mask].copy()
                if member_df.empty:
                    continue
                X_member, y_member = prepare_features(member_df)
                if X_member.empty:
                    continue
                if y_member.nunique() < 2:
                    continue
                if selected_features:
                    X_member = align_features(X_member, selected_features)
                member_pipeline = build_pipeline(X_member, model_type)
                fit_pipeline(member_pipeline, X_member, y_member, model_type)
                preprocess = member_pipeline.named_steps.get('preprocess')
                expected = list(getattr(preprocess, 'feature_names_in_', []))
                X_eval = align_features(X_val, expected) if expected else X_val
                probs_per_model.append(member_pipeline.predict_proba(X_eval)[:, 1])
                used_members += 1

            if not probs_per_model:
                continue
            y_prob = np.mean(np.vstack(probs_per_model), axis=0)
        else:
            pipeline = build_pipeline(X_tr, model_type)
            fit_pipeline(pipeline, X_tr, y_tr, model_type)
            preprocess = pipeline.named_steps.get('preprocess')
            expected = list(getattr(preprocess, 'feature_names_in_', []))
            X_eval = align_features(X_val, expected) if expected else X_val
            y_prob = pipeline.predict_proba(X_eval)[:, 1]
            used_members = 1

        fold_thresholds = threshold_rows(y_val.to_numpy(), y_prob)
        try:
            auc = float(roc_auc_score(y_val, y_prob))
        except ValueError:
            auc = float('nan')
        fold_scores.append(auc)
        tr_ts = _to_epoch_ms(_to_entry_timestamp(fold_train))
        te_ts = _to_epoch_ms(_to_entry_timestamp(fold_val))
        fold_row = {
            'fold': float(fold),
            'train_rows': float(len(y_tr)),
            'test_rows': float(len(y_val)),
            'auc': auc,
            'start_ts': float(te_ts.min()) if not te_ts.empty else float('nan'),
            'end_ts': float(te_ts.max()) if not te_ts.empty else float('nan'),
            'train_start_ts': float(tr_ts.min()) if not tr_ts.empty else float('nan'),
            'train_end_ts': float(tr_ts.max()) if not tr_ts.empty else float('nan'),
            'test_start_ts': float(te_ts.min()) if not te_ts.empty else float('nan'),
            'test_end_ts': float(te_ts.max()) if not te_ts.empty else float('nan'),
            'threshold_rows': fold_thresholds,
            'ensemble_members': float(used_members),
        }
        fold_rows.append(fold_row)
        print(
            f'Walk-forward holdout {fold}/{total_folds}: '
            f'train={len(y_tr)} val={len(y_val)} auc={auc:.4f} members={used_members}'
        )
        print(f'Walk-forward fold {fold}/{total_folds} threshold table:')
        print_threshold_table(y_val.to_numpy(), y_prob)

    valid = [score for score in fold_scores if np.isfinite(score)]
    if valid:
        print(
            f'Walk-forward AUC mean={np.mean(valid):.4f} std={np.std(valid):.4f} '
            f'({len(valid)} folds)'
        )
    return valid, fold_rows, 'external-fold-files'


def extract_profit_array(df: pd.DataFrame) -> np.ndarray | None:
    if 'profit' not in df.columns or 'label' not in df.columns:
        return None
    labeled = df[df['label'].notna()].copy()
    if labeled.empty:
        return None
    profit = pd.to_numeric(labeled['profit'], errors='coerce').to_numpy(dtype=float)
    return profit if len(profit) else None


def extract_regime_array(X: pd.DataFrame) -> np.ndarray | None:
    if 'Regime_IsHighVol' not in X.columns:
        return None
    regime = pd.to_numeric(X['Regime_IsHighVol'], errors='coerce').fillna(0).to_numpy(dtype=float)
    return regime if len(regime) else None


def fit_incremental_catboost_model(
    input_path: str,
    chunk_size: int,
    incremental_iterations: int,
    seed: int,
    stage_label: str,
    member_idx: int,
    total_members: int,
    init_model=None,
    feature_order: list[str] | None = None,
    cat_feature_indexes: list[int] | None = None,
):
    model = init_model
    feature_order = feature_order or []
    cat_feature_indexes = cat_feature_indexes or []
    trained_chunks = 0
    trained_rows = 0

    for chunk in iter_dataset_chunks(input_path, chunk_size):
        X_chunk, y_chunk = prepare_features(chunk)
        if X_chunk.empty:
            continue

        if not feature_order:
            feature_order = list(X_chunk.columns)
            cat_feature_indexes = [
                idx
                for idx, col in enumerate(feature_order)
                if X_chunk[col].dtype == 'object' or str(X_chunk[col].dtype) == 'category'
            ]
        else:
            X_chunk = align_features(X_chunk, feature_order)

        next_model = build_model('catboost')
        next_model.set_params(
            iterations=incremental_iterations,
            random_seed=seed,
        )
        fit_kwargs = {'cat_features': cat_feature_indexes}
        if model is not None:
            fit_kwargs['init_model'] = model

        print(
            f'[{stage_label}] model {member_idx}/{total_members} '
            f'chunk {trained_chunks + 1} ({len(y_chunk)} rows)'
        )
        next_model.fit(X_chunk, y_chunk, **fit_kwargs)
        model = next_model
        trained_chunks += 1
        trained_rows += len(y_chunk)

    if model is None:
        raise SystemExit('No training rows found. Check labels or input file.')

    print(
        f'[{stage_label}] model {member_idx}/{total_members} done: '
        f'chunks={trained_chunks}, rows={trained_rows}'
    )
    return model, feature_order, cat_feature_indexes


def train_incremental_catboost(
    train_input: str,
    test_input: str,
    model_base: str,
    chunk_size: int,
    incremental_iterations: int,
    ensemble: bool,
    ensemble_members: int,
    seed: int,
    report_dir: str,
    strategy: str,
) -> None:
    members = ensemble_members if ensemble else 1
    model_infos: list[tuple[object, list[str], list[int]]] = []
    artifact_stamp = utc_stamp()

    for i in range(members):
        member_seed = seed + i
        model, feature_order, cat_feature_indexes = fit_incremental_catboost_model(
            input_path=train_input,
            chunk_size=chunk_size,
            incremental_iterations=incremental_iterations,
            seed=member_seed,
            stage_label='Train',
            member_idx=i + 1,
            total_members=members,
        )
        model_infos.append((model, feature_order, cat_feature_indexes))

    eval_rows = 0
    y_true_all: list[np.ndarray] = []
    y_prob_all: list[np.ndarray] = []
    y_pred_all: list[np.ndarray] = []
    profit_all: list[np.ndarray] = []
    regime_all: list[np.ndarray] = []
    for chunk in iter_dataset_chunks(test_input, chunk_size):
        X_chunk, y_chunk = prepare_features(chunk)
        if X_chunk.empty:
            continue
        regime_chunk = extract_regime_array(X_chunk)
        labeled_chunk = chunk[chunk['label'].notna()].copy()
        if 'profit' in labeled_chunk.columns:
            profit_chunk = pd.to_numeric(labeled_chunk['profit'], errors='coerce').to_numpy(dtype=float)
        else:
            profit_chunk = np.full(len(y_chunk), np.nan, dtype=float)
        if len(profit_chunk) != len(y_chunk):
            profit_chunk = np.full(len(y_chunk), np.nan, dtype=float)

        probs_per_model = []
        for model, feature_order, _cat_feature_indexes in model_infos:
            X_eval = align_features(X_chunk.copy(), feature_order)
            probs_per_model.append(model.predict_proba(X_eval)[:, 1])

        avg_prob = np.mean(np.vstack(probs_per_model), axis=0)
        y_pred = (avg_prob >= 0.5).astype(int)
        y_true_all.append(y_chunk.to_numpy())
        y_prob_all.append(avg_prob)
        y_pred_all.append(y_pred)
        profit_all.append(profit_chunk)
        if regime_chunk is not None and len(regime_chunk) == len(y_chunk):
            regime_all.append(regime_chunk)
        eval_rows += len(y_chunk)

    if not y_true_all:
        raise SystemExit('No test rows found in --test-input.')

    y_true = np.concatenate(y_true_all)
    y_prob = np.concatenate(y_prob_all)
    y_pred = np.concatenate(y_pred_all)
    eval_profit = np.concatenate(profit_all) if profit_all else None
    eval_regime = np.concatenate(regime_all) if regime_all else None
    print(f'Incremental eval rows: {eval_rows}')
    metrics = compute_binary_metrics(y_true, y_pred)
    print(
        'Incremental metrics: '
        f"accuracy={metrics['accuracy']:.4f} "
        f"precision={metrics['precision']:.4f} "
        f"recall={metrics['recall']:.4f} "
        f"f1={metrics['f1']:.4f}"
    )
    try:
        print('ROC AUC:', roc_auc_score(y_true, y_prob))
    except ValueError:
        print('ROC AUC: n/a')
    print_threshold_table(y_true, y_prob)
    eval_report_path = f'{model_base}.eval.{artifact_stamp}.report.html'
    eval_report_saved = create_training_html_report(
        report_dir=report_dir,
        strategy=strategy,
        model_type='catboost',
        y_true=y_true,
        y_prob=y_prob,
        X_eval=None,
        extra={'mode': 'incremental'},
        out_path=eval_report_path,
        profit=eval_profit,
        regime_high_vol=eval_regime,
    )
    eval_auc = float('nan')
    try:
        eval_auc = float(roc_auc_score(y_true, y_prob))
    except ValueError:
        pass

    prod_models: list[object] = []
    for i, (model, feature_order, cat_feature_indexes) in enumerate(model_infos):
        member_seed = seed + i
        updated_model, _feature_order, _cat_features = fit_incremental_catboost_model(
            input_path=test_input,
            chunk_size=chunk_size,
            incremental_iterations=incremental_iterations,
            seed=member_seed,
            stage_label='Prod finetune',
            member_idx=i + 1,
            total_members=members,
            init_model=model,
            feature_order=feature_order,
            cat_feature_indexes=cat_feature_indexes,
        )
        prod_models.append(updated_model)

    if ensemble:
        for idx, model in enumerate(prod_models, start=1):
            path = f'{model_base}.model{idx}.prod.{artifact_stamp}.joblib'
            pipeline = Pipeline(
                steps=[
                    ('preprocess', 'passthrough'),
                    ('model', model),
                ]
            )
            joblib.dump(pipeline, path)
            print('Prod model saved:', path)
            alias = f'{model_base}.model{idx}.joblib'
            shutil.copy2(path, alias)
            print('Prod alias updated:', alias)
    else:
        model_path = f'{model_base}.prod.{artifact_stamp}.joblib'
        pipeline = Pipeline(
            steps=[
                ('preprocess', 'passthrough'),
                ('model', prod_models[0]),
            ]
        )
        joblib.dump(pipeline, model_path)
        print('Prod model saved:', model_path)
        alias = f'{model_base}.joblib'
        shutil.copy2(model_path, alias)
        print('Prod alias updated:', alias)

    eval_md_path = f'{model_base}.eval.{artifact_stamp}.md'
    eval_lines = [
        f'# Model Notes: {strategy} eval',
        '',
        f'- timestamp_utc: {artifact_stamp}',
        '- mode: eval',
        '- model_type: catboost',
        '- training_mode: incremental',
        f'- ensemble: {ensemble}',
        f'- chunk_size: {chunk_size}',
        f'- incremental_iterations: {incremental_iterations}',
        f'- test_rows: {len(y_true)}',
        f'- roc_auc: {eval_auc:.6f}' if np.isfinite(eval_auc) else '- roc_auc: n/a',
        f'- report_file: {os.path.basename(eval_report_saved or eval_report_path)}',
    ]
    eval_lines += ['', *threshold_markdown_lines(y_true, y_prob, profit=eval_profit)]
    eval_lines += ['', *gain_markdown_lines(y_true, y_prob, profit=eval_profit)]
    eval_lines += ['', *policy_markdown_lines(y_true, y_prob, regime_high_vol=eval_regime, profit=eval_profit)]
    write_training_notes(eval_md_path, eval_lines)
    print('Eval notes saved:', eval_md_path)

    if not ensemble:
        prod_md_path = f'{model_base}.prod.{artifact_stamp}.md'
        prod_lines = [
            f'# Model Notes: {strategy} prod',
            '',
            f'- timestamp_utc: {artifact_stamp}',
            '- mode: prod',
            '- model_type: catboost',
            '- training_mode: incremental',
            f'- ensemble: {ensemble}',
            f'- chunk_size: {chunk_size}',
            f'- incremental_iterations: {incremental_iterations}',
            f'- roc_auc_ref_holdout: {eval_auc:.6f}' if np.isfinite(eval_auc) else '- roc_auc_ref_holdout: n/a',
            f'- model_file: {os.path.basename(model_path)}',
        ]
        prod_lines += ['', *threshold_markdown_lines(y_true, y_prob, profit=eval_profit)]
        prod_lines += ['', *gain_markdown_lines(y_true, y_prob, profit=eval_profit)]
        prod_lines += ['', *policy_markdown_lines(y_true, y_prob, regime_high_vol=eval_regime, profit=eval_profit)]
        write_training_notes(prod_md_path, prod_lines)
        print('Prod notes saved:', prod_md_path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True, help='Path to CSV or JSONL')
    parser.add_argument('--strategy', default='default')
    parser.add_argument('--model', default='')
    parser.add_argument('--test-input', default='', help='Optional test CSV or JSONL')
    parser.add_argument('--prod-input', default='', help='Optional prod CSV or JSONL')
    parser.add_argument('--walk-forward-input', default='', help='Optional walk-forward CSV or JSONL')
    parser.add_argument(
        '--walk-forward-fold-train-input',
        action='append',
        default=[],
        help='Optional walk-forward fold train CSV or JSONL (repeat per fold)',
    )
    parser.add_argument(
        '--walk-forward-fold-test-input',
        action='append',
        default=[],
        help='Optional walk-forward fold test CSV or JSONL (repeat per fold)',
    )
    parser.add_argument('--test-days', type=int, default=30, help='Hold out last N days for test')
    parser.add_argument(
        '--ensemble',
        action='store_true',
        help='Train expanding-window ensemble models, eval on holdout, then retrain prod ensemble on all data',
    )
    parser.add_argument(
        '--ensemble-members',
        type=int,
        default=2,
        help='Number of ensemble members for --ensemble mode (>=2)',
    )
    parser.add_argument(
        '--model-type',
        choices=['catboost', 'random_forest', 'extra_trees', 'xgboost', 'lightgbm'],
        default='random_forest',
    )
    parser.add_argument(
        '--incremental',
        action='store_true',
        help='Incremental chunk training for catboost to lower peak memory usage',
    )
    parser.add_argument('--chunk-size', type=int, default=20_000)
    parser.add_argument('--incremental-iterations', type=int, default=30)
    parser.add_argument(
        '--train-recent-days',
        type=int,
        default=60,
        help='Use only last N days of train set (0 disables; useful under concept drift)',
    )
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument(
        '--feature-profile',
        choices=['all', 'robust'],
        default='all',
        help='Feature selection profile before fitting',
    )
    parser.add_argument(
        '--feature-set',
        choices=['enriched', 'legacy'],
        default='legacy',
        help='Feature families: enriched (all) or legacy (without Ctx/Regime/XS)',
    )
    parser.add_argument(
        '--walk-forward-folds',
        type=int,
        default=2,
        help='Sequential historical holdout windows (0/1 disables)',
    )
    parser.add_argument(
        '--walk-forward-spec',
        default='',
        help='Path to fixed walk-forward window spec JSON (reused across runs)',
    )
    parser.add_argument(
        '--report-dir',
        default='data/ml/models',
        help='Directory for generated HTML reports',
    )
    args = parser.parse_args()
    print(f'Using model type: {args.model_type}')
    selected_features: list[str] | None = None

    if args.incremental:
        if args.model_type != 'catboost':
            raise SystemExit('--incremental is supported only for --model-type catboost.')
        if not args.test_input:
            raise SystemExit('--incremental requires --test-input.')
        model_base = model_base_from_arg(args.model, args.strategy)
        ensure_parent_dir(model_base)
        clear_strategy_models(model_base)
        train_incremental_catboost(
            train_input=args.input,
            test_input=args.test_input,
            model_base=model_base,
            chunk_size=args.chunk_size,
            incremental_iterations=args.incremental_iterations,
            ensemble=args.ensemble,
            ensemble_members=args.ensemble_members,
            seed=args.seed,
            report_dir=args.report_dir,
            strategy=args.strategy,
        )
        return

    df = load_dataset(args.input)
    X, y = prepare_features(df)

    if X.empty:
        raise SystemExit('No training rows found. Check labels or input file.')

    total = len(y)
    pos = int((y == 1).sum())
    neg = int((y == 0).sum())
    pos_rate = pos / total if total else 0.0

    if total < 500:
        print(f"Warning: very small dataset ({total}). Expect unstable model.")
    elif total < 1000:
        print(f"Warning: small dataset ({total}). Results may be noisy.")

    if pos == 0 or neg == 0:
        raise SystemExit("Only one class present. Need both positive and negative outcomes.")

    if pos_rate < 0.2 or pos_rate > 0.8:
        print(
            f"Warning: class imbalance (pos_rate={pos_rate:.2%}). Consider more data or balancing."
        )

    train_df_for_walk_forward: pd.DataFrame | None = None

    if args.test_input:
        test_df = load_dataset(args.test_input)
        train_df = df[df['label'].notna()].copy()
        train_df_for_walk_forward = train_df.copy()
        if args.train_recent_days > 0:
            original_rows = len(train_df)
            train_df = keep_recent_days(train_df, args.train_recent_days)
            print(
                f'Recent-train filter: last {args.train_recent_days}d '
                f'({original_rows} -> {len(train_df)} rows)'
            )
        if train_df.empty:
            raise SystemExit('No training rows found in --input.')
        X_train, y_train = prepare_features(train_df)
        X_test, y_test = prepare_features(test_df)
        X_train = apply_feature_set(X_train, args.feature_set)
        X_test = apply_feature_set(X_test, args.feature_set)
        if args.feature_profile == 'robust':
            selected_features = select_robust_feature_columns(X_train)
            X_train = align_features(X_train, selected_features)
            X_test = align_features(X_test, selected_features)
        if X_test.empty:
            raise SystemExit('No test rows found in --test-input.')
        print(f'Dataset split source: external files (--input train, --test-input test)')
        print(f'Train rows: {len(y_train)}, Test rows: {len(y_test)}')
    else:
        train_df, test_df = split_last_days(df, args.test_days)
        train_df_for_walk_forward = train_df.copy()
        if args.train_recent_days > 0:
            original_rows = len(train_df)
            train_df = keep_recent_days(train_df, args.train_recent_days)
            print(
                f'Recent-train filter: last {args.train_recent_days}d '
                f'({original_rows} -> {len(train_df)} rows)'
            )
        if train_df.empty:
            raise SystemExit('No training rows found after --train-recent-days filter.')
        X_train, y_train = prepare_features(train_df)
        X_test, y_test = prepare_features(test_df)
        X_train = apply_feature_set(X_train, args.feature_set)
        X_test = apply_feature_set(X_test, args.feature_set)
        if args.feature_profile == 'robust':
            selected_features = select_robust_feature_columns(X_train)
            X_train = align_features(X_train, selected_features)
            X_test = align_features(X_test, selected_features)

    model_base = model_base_from_arg(args.model, args.strategy)
    eval_profit = extract_profit_array(test_df)
    eval_regime = extract_regime_array(X_test)
    if args.prod_input:
        prod_source_df = load_dataset(args.prod_input)
        prod_source_df = prod_source_df[prod_source_df['label'].notna()].copy()
        print(
            'Prod source: external file '
            f'(--prod-input, rows={len(prod_source_df)})'
        )
    else:
        prod_source_df = pd.concat([train_df, test_df], ignore_index=True)
        prod_source_df = prod_source_df[prod_source_df['label'].notna()].copy()
    fold_train_inputs = [
        str(item).strip() for item in args.walk_forward_fold_train_input if str(item).strip()
    ]
    fold_test_inputs = [
        str(item).strip() for item in args.walk_forward_fold_test_input if str(item).strip()
    ]
    if fold_train_inputs or fold_test_inputs:
        if len(fold_train_inputs) != len(fold_test_inputs):
            raise SystemExit(
                'Walk-forward fold file count mismatch '
                f'(train={len(fold_train_inputs)}, test={len(fold_test_inputs)}).'
            )
        if args.walk_forward_folds > 0 and len(fold_train_inputs) != args.walk_forward_folds:
            raise SystemExit(
                'Walk-forward fold files count does not match --walk-forward-folds '
                f'({len(fold_train_inputs)} != {args.walk_forward_folds}).'
            )
        print(
            'Walk-forward source: explicit fold files '
            f'(folds={len(fold_train_inputs)})'
        )
        walk_forward_scores, walk_forward_rows, walk_forward_spec_path = (
            run_walk_forward_validation_from_files(
                train_inputs=fold_train_inputs,
                test_inputs=fold_test_inputs,
                model_type=args.model_type,
                train_recent_days=args.train_recent_days,
                selected_features=selected_features,
                ensemble=args.ensemble,
                ensemble_members=args.ensemble_members,
            )
        )
    else:
        # Build walk-forward windows on a dedicated source file when provided.
        # Otherwise use the full pre-holdout training side, then apply
        # --train-recent-days per fold inside walk-forward fitting.
        if args.walk_forward_input:
            walk_forward_source_df = load_dataset(args.walk_forward_input)
            walk_forward_source_df = walk_forward_source_df[
                walk_forward_source_df['label'].notna()
            ].copy()
            print(
                'Walk-forward source: external file '
                f'(--walk-forward-input, rows={len(walk_forward_source_df)})'
            )
        else:
            walk_forward_source_df = (
                train_df_for_walk_forward.copy()
                if train_df_for_walk_forward is not None
                else train_df.copy()
            )
        walk_forward_spec_path = (
            args.walk_forward_spec.strip()
            if args.walk_forward_spec.strip()
            else _default_walk_forward_spec_path(
                report_dir=args.report_dir,
                strategy=args.strategy,
                input_path=args.input,
                test_input_path=args.test_input,
                folds=args.walk_forward_folds,
                test_days=args.test_days,
            )
        )
        walk_forward_scores, walk_forward_rows, walk_forward_spec_path = run_walk_forward_validation(
            source_df=walk_forward_source_df,
            model_type=args.model_type,
            folds=args.walk_forward_folds,
            test_days=args.test_days,
            train_recent_days=args.train_recent_days,
            spec_path=walk_forward_spec_path,
            selected_features=selected_features,
            ensemble=args.ensemble,
            ensemble_members=args.ensemble_members,
        )
    print_evaluation_windows_summary(
        train_df=train_df,
        test_df=test_df,
        train_rows=len(y_train),
        test_rows=len(y_test),
        walk_forward_rows=walk_forward_rows,
    )

    ensure_parent_dir(model_base)
    clear_strategy_models(model_base)
    artifact_stamp = utc_stamp()
    walk_forward_mean = float(np.mean(walk_forward_scores)) if walk_forward_scores else float('nan')
    walk_forward_std = float(np.std(walk_forward_scores)) if walk_forward_scores else float('nan')
    if args.ensemble:
        if args.ensemble_members < 2:
            raise SystemExit('--ensemble-members must be >= 2 when --ensemble is enabled.')
        # Phase 1: Evaluate ensemble on holdout test using train-only data.
        eval_cutoffs = compute_ensemble_cutoffs(train_df, members=args.ensemble_members)
        eval_models = []
        total_models = len(eval_cutoffs)
        train_ts = train_df['entryTimestamp'].astype('Int64')
        for idx, cutoff in enumerate(eval_cutoffs, start=1):
            bar_width = 20
            filled = int(bar_width * (idx - 1) / total_models)
            bar = '#' * filled + '-' * (bar_width - filled)
            sys.stdout.write(
                f'\rEval ensemble progress [{bar}] {idx - 1}/{total_models}'
            )
            sys.stdout.flush()
            mask = train_ts <= cutoff
            X_tr, y_tr = prepare_features(train_df[mask])
            if selected_features:
                X_tr = align_features(X_tr, selected_features)
            pipeline = build_pipeline(X_tr, args.model_type)
            fit_pipeline(pipeline, X_tr, y_tr, args.model_type)
            eval_models.append((pipeline, cutoff))
            preprocess = pipeline.named_steps.get('preprocess')
            expected = list(getattr(preprocess, 'feature_names_in_', []))
            X_eval = align_features(X_test.copy(), expected)
            y_pred = pipeline.predict(X_eval)
            y_prob = pipeline.predict_proba(X_eval)[:, 1]
            print(f'\n== Eval Model {idx} (<= {cutoff}) ==')
            print(classification_report(y_test, y_pred, digits=3))
            try:
                print('ROC AUC:', roc_auc_score(y_test, y_prob))
            except ValueError:
                print('ROC AUC: n/a')
        bar = '#' * bar_width
        sys.stdout.write(
            f'\rEval ensemble progress [{bar}] {total_models}/{total_models}\n'
        )
        sys.stdout.flush()

        eval_probs = []
        for model, _cutoff in eval_models:
            preprocess = model.named_steps.get('preprocess')
            expected = list(getattr(preprocess, 'feature_names_in_', []))
            X_eval = align_features(X_test.copy(), expected)
            eval_probs.append(model.predict_proba(X_eval)[:, 1])
        avg_prob = np.mean(np.vstack(eval_probs), axis=0)
        y_pred = (avg_prob >= 0.5).astype(int)
        print('== Eval Ensemble (avg prob, threshold=0.5) ==')
        print(classification_report(y_test, y_pred, digits=3))
        try:
            print('ROC AUC:', roc_auc_score(y_test, avg_prob))
        except ValueError:
            print('ROC AUC: n/a')
        print_threshold_table(y_test.to_numpy(), avg_prob)
        eval_report_path = f'{model_base}.ensemble.eval.{artifact_stamp}.report.html'
        eval_report_saved = create_training_html_report(
            report_dir=args.report_dir,
            strategy=args.strategy,
            model_type=args.model_type,
            y_true=y_test.to_numpy(),
            y_prob=avg_prob,
            X_eval=X_test,
            extra={'mode': 'ensemble_eval'},
            out_path=eval_report_path,
            profit=eval_profit,
            regime_high_vol=eval_regime,
        )
        eval_auc = float('nan')
        try:
            eval_auc = float(roc_auc_score(y_test, avg_prob))
        except ValueError:
            pass

        eval_model_paths: list[str] = []
        for idx, (model, _cutoff) in enumerate(eval_models, start=1):
            eval_member_path = f'{model_base}.model{idx}.eval.{artifact_stamp}.joblib'
            joblib.dump(model, eval_member_path)
            eval_model_paths.append(eval_member_path)
            print('Eval model saved:', eval_member_path)
        eval_md_path = f'{model_base}.ensemble.eval.{artifact_stamp}.md'
        eval_lines = [
            f'# Model Notes: {args.strategy} ensemble eval',
            '',
            f'- timestamp_utc: {artifact_stamp}',
            '- mode: eval',
            f'- model_type: {args.model_type}',
            f'- feature_profile: {args.feature_profile}',
            f'- feature_set: {args.feature_set}',
            f'- train_recent_days: {args.train_recent_days}',
            f'- walk_forward_folds: {args.walk_forward_folds}',
            f'- walk_forward_test_days: {args.test_days}',
            f'- walk_forward_spec: {walk_forward_spec_path}',
            (
                f'- walk_forward_auc_mean: {walk_forward_mean:.6f}'
                if np.isfinite(walk_forward_mean)
                else '- walk_forward_auc_mean: n/a'
            ),
            (
                f'- walk_forward_auc_std: {walk_forward_std:.6f}'
                if np.isfinite(walk_forward_std)
                else '- walk_forward_auc_std: n/a'
            ),
            f'- ensemble_members: {args.ensemble_members}',
            f'- train_rows: {len(y_train)}',
            f'- test_rows: {len(y_test)}',
            f'- roc_auc: {eval_auc:.6f}' if np.isfinite(eval_auc) else '- roc_auc: n/a',
            f'- report_file: {os.path.basename(eval_report_saved or eval_report_path)}',
        ]
        eval_lines += [
            '',
            *evaluation_windows_markdown_lines(
                train_df=train_df,
                test_df=test_df,
                train_rows=len(y_train),
                test_rows=len(y_test),
                walk_forward_rows=walk_forward_rows,
            ),
        ]
        eval_lines += ['', *threshold_markdown_lines(y_test.to_numpy(), avg_prob, profit=eval_profit)]
        eval_lines += ['', *gain_markdown_lines(y_test.to_numpy(), avg_prob, profit=eval_profit)]
        eval_lines += ['', *policy_markdown_lines(y_test.to_numpy(), avg_prob, regime_high_vol=eval_regime, profit=eval_profit)]
        eval_lines += ['', *walk_forward_markdown_lines(walk_forward_rows)]
        eval_lines += ['', *walk_forward_threshold_markdown_lines(walk_forward_rows)]
        write_training_notes(eval_md_path, eval_lines)
        print('Eval notes saved:', eval_md_path)

        # Phase 2: Train prod ensemble on dedicated prod source.
        full_df = prod_source_df.copy()
        prod_cutoffs = compute_ensemble_cutoffs(full_df, members=args.ensemble_members)
        prod_models = []
        total_models = len(prod_cutoffs)
        full_ts = full_df['entryTimestamp'].astype('Int64')
        for idx, cutoff in enumerate(prod_cutoffs, start=1):
            bar_width = 20
            filled = int(bar_width * (idx - 1) / total_models)
            bar = '#' * filled + '-' * (bar_width - filled)
            sys.stdout.write(
                f'\rProd ensemble progress [{bar}] {idx - 1}/{total_models}'
            )
            sys.stdout.flush()
            mask = full_ts <= cutoff
            X_tr, y_tr = prepare_features(full_df[mask])
            if selected_features:
                X_tr = align_features(X_tr, selected_features)
            pipeline = build_pipeline(X_tr, args.model_type)
            fit_pipeline(pipeline, X_tr, y_tr, args.model_type)
            prod_models.append(pipeline)
        bar = '#' * bar_width
        sys.stdout.write(
            f'\rProd ensemble progress [{bar}] {total_models}/{total_models}\n'
        )
        sys.stdout.flush()

        for idx, model in enumerate(prod_models, start=1):
            path = f'{model_base}.model{idx}.prod.{artifact_stamp}.joblib'
            joblib.dump(model, path)
            print('Prod model saved:', path)
            alias = f'{model_base}.model{idx}.joblib'
            shutil.copy2(path, alias)
            print('Prod alias updated:', alias)
        eval_lines += [
            '',
            '## Prod Build',
            '',
            f'- full_rows: {len(full_df)}',
            f'- members: {len(prod_models)}',
            f'- roc_auc_ref_holdout: {eval_auc:.6f}' if np.isfinite(eval_auc) else '- roc_auc_ref_holdout: n/a',
            '- prod_model_files:',
        ]
        for idx in range(1, len(prod_models) + 1):
            eval_lines.append(
                f'  - {os.path.basename(f"{model_base}.model{idx}.prod.{artifact_stamp}.joblib")}'
            )
        write_training_notes(eval_md_path, eval_lines)
        print('Notes saved:', eval_md_path)

        for path in eval_model_paths:
            try:
                os.remove(path)
                print('Eval model removed:', path)
            except OSError:
                pass
    else:
        # Eval single model on holdout.
        pipeline = build_pipeline(X_train, args.model_type)
        fit_pipeline(pipeline, X_train, y_train, args.model_type)

        preprocess = pipeline.named_steps.get('preprocess')
        expected = list(getattr(preprocess, 'feature_names_in_', []))
        X_eval = align_features(X_test.copy(), expected) if expected else X_test

        y_pred = pipeline.predict(X_eval)
        y_prob = pipeline.predict_proba(X_eval)[:, 1]

        print('== Eval Single ==')
        print(classification_report(y_test, y_pred, digits=3))
        try:
            print('ROC AUC:', roc_auc_score(y_test, y_prob))
        except ValueError:
            print('ROC AUC: n/a')
        print_threshold_table(y_test.to_numpy(), y_prob)

        artifact_stamp = utc_stamp()
        eval_report_path = f'{model_base}.eval.{artifact_stamp}.report.html'
        eval_md_path = f'{model_base}.eval.{artifact_stamp}.md'
        eval_model_path = f'{model_base}.eval.{artifact_stamp}.joblib'
        joblib.dump(pipeline, eval_model_path)
        print('Eval model saved:', eval_model_path)
        eval_report_saved = create_training_html_report(
            report_dir=args.report_dir,
            strategy=args.strategy,
            model_type=args.model_type,
            y_true=y_test.to_numpy(),
            y_prob=y_prob,
            X_eval=X_test,
            extra={'mode': 'single_eval'},
            out_path=eval_report_path,
            profit=eval_profit,
            regime_high_vol=eval_regime,
        )
        eval_auc = float('nan')
        try:
            eval_auc = float(roc_auc_score(y_test, y_prob))
        except ValueError:
            pass
        eval_lines = [
            f'# Model Notes: {args.strategy} eval',
            '',
            f'- timestamp_utc: {artifact_stamp}',
            f'- mode: eval',
            f'- model_type: {args.model_type}',
            f'- feature_profile: {args.feature_profile}',
            f'- feature_set: {args.feature_set}',
            f'- train_recent_days: {args.train_recent_days}',
            f'- walk_forward_folds: {args.walk_forward_folds}',
            f'- walk_forward_test_days: {args.test_days}',
            f'- walk_forward_spec: {walk_forward_spec_path}',
            (
                f'- walk_forward_auc_mean: {walk_forward_mean:.6f}'
                if np.isfinite(walk_forward_mean)
                else '- walk_forward_auc_mean: n/a'
            ),
            (
                f'- walk_forward_auc_std: {walk_forward_std:.6f}'
                if np.isfinite(walk_forward_std)
                else '- walk_forward_auc_std: n/a'
            ),
            f'- train_rows: {len(y_train)}',
            f'- test_rows: {len(y_test)}',
            f'- roc_auc: {eval_auc:.6f}' if np.isfinite(eval_auc) else '- roc_auc: n/a',
            f'- report_file: {os.path.basename(eval_report_saved or eval_report_path)}',
            '',
            '## Train Command',
            '',
            f'`python /app/ml/train.py --input {args.input} --test-input {args.test_input} --strategy {args.strategy} --model-type {args.model_type} --feature-set {args.feature_set}`',
        ]
        eval_lines += [
            '',
            *evaluation_windows_markdown_lines(
                train_df=train_df,
                test_df=test_df,
                train_rows=len(y_train),
                test_rows=len(y_test),
                walk_forward_rows=walk_forward_rows,
            ),
        ]
        eval_lines += ['', *threshold_markdown_lines(y_test.to_numpy(), y_prob, profit=eval_profit)]
        eval_lines += ['', *gain_markdown_lines(y_test.to_numpy(), y_prob, profit=eval_profit)]
        eval_lines += ['', *policy_markdown_lines(y_test.to_numpy(), y_prob, regime_high_vol=eval_regime, profit=eval_profit)]
        eval_lines += ['', *walk_forward_markdown_lines(walk_forward_rows)]
        eval_lines += ['', *walk_forward_threshold_markdown_lines(walk_forward_rows)]
        write_training_notes(eval_md_path, eval_lines)
        print('Notes saved:', eval_md_path)

        # Prod single model on dedicated prod source.
        full_df = prod_source_df.copy()
        X_full, y_full = prepare_features(full_df)
        X_full = apply_feature_set(X_full, args.feature_set)
        if selected_features:
            X_full = align_features(X_full, selected_features)
        prod_pipeline = build_pipeline(X_full, args.model_type)
        fit_pipeline(prod_pipeline, X_full, y_full, args.model_type)

        prod_model_path = f'{model_base}.prod.{artifact_stamp}.joblib'
        joblib.dump(prod_pipeline, prod_model_path)
        print('Prod model saved:', prod_model_path)
        eval_lines += [
            '',
            '## Prod Build',
            '',
            f'- full_rows: {len(y_full)}',
            f'- roc_auc_ref_holdout: {eval_auc:.6f}' if np.isfinite(eval_auc) else '- roc_auc_ref_holdout: n/a',
            f'- prod_model_file: {os.path.basename(prod_model_path)}',
        ]
        write_training_notes(eval_md_path, eval_lines)
        print('Notes updated:', eval_md_path)

        try:
            os.remove(eval_model_path)
            print('Eval model removed:', eval_model_path)
        except OSError:
            pass

        # Stable alias for inference path compatibility.
        alias_model_path = f'{model_base}.joblib'
        shutil.copy2(prod_model_path, alias_model_path)
        print('Prod alias updated:', alias_model_path)


if __name__ == '__main__':
    main()
