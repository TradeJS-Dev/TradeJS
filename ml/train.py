import argparse
import glob
import json
import os
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
from sklearn.ensemble import RandomForestClassifier


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
    missing = [c for c in expected if c not in X.columns]
    if missing:
        for col in missing:
            X[col] = 0
    extra = [c for c in X.columns if c not in expected]
    if extra:
        X = X.drop(columns=extra)
    return X[expected]


def print_threshold_table(y_true: np.ndarray, y_prob: np.ndarray) -> None:
    thresholds = np.round(np.linspace(0.05, 0.95, 19), 2)
    base_rate = float((y_true == 1).mean()) if len(y_true) else 0.0
    pos = int((y_true == 1).sum())
    neg = int((y_true == 0).sum())
    print(f'base_rate={base_rate:.4f} (pos={pos} neg={neg} n={len(y_true)})')
    print('threshold  precision  recall  f1     coverage')
    for t in thresholds:
        preds = (y_prob >= t).astype(int)
        precision, recall, f1, _ = precision_recall_fscore_support(
            y_true, preds, average='binary', zero_division=0
        )
        coverage = float(preds.mean()) if len(preds) else 0.0
        print(f'{t:>8.2f}  {precision:>9.3f}  {recall:>6.3f}  {f1:>5.3f}  {coverage:>8.3f}')


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


def build_model(model_type: str):
    if model_type == 'catboost':
        try:
            from catboost import CatBoostClassifier  # type: ignore
        except ImportError as exc:
            raise SystemExit(
                "catboost is not installed. Add it to ml/requirements.txt or use --model-type random_forest."
            ) from exc
        return CatBoostClassifier(
            iterations=500,
            depth=6,
            learning_rate=0.05,
            random_seed=42,
            loss_function='Logloss',
            eval_metric='AUC',
            auto_class_weights='Balanced',
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


def compute_ensemble_cutoffs(source_df: pd.DataFrame) -> list[int]:
    ts = source_df['entryTimestamp'].astype('Int64')
    if ts.isna().all():
        raise SystemExit('entryTimestamp is missing or invalid for ensemble training.')
    ts_values = ts.dropna().astype(int).to_numpy()
    t1, t2, t3, t4, t5 = np.quantile(ts_values, [0.2, 0.4, 0.6, 0.8, 1.0])
    return [int(t1), int(t2), int(t3), int(t4), int(t5)]


def filter_by_direction(df: pd.DataFrame, direction_value: int) -> pd.DataFrame:
    if 'direction' not in df.columns:
        raise SystemExit('direction is required to train LONG/SHORT-specific models.')
    return df[df['direction'] == direction_value].copy()


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

    patterns = [
        f'{model_base}.model*.joblib',
        f'{model_base}.long.model*.joblib',
        f'{model_base}.short.model*.joblib',
    ]
    for pattern in patterns:
        for path in glob.glob(pattern):
            existing_paths.add(path)

    for single in [
        f'{model_base}.joblib',
        f'{model_base}.long.joblib',
        f'{model_base}.short.joblib',
    ]:
        if os.path.exists(single):
            existing_paths.add(single)

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


def fit_incremental_catboost_model(
    input_path: str,
    chunk_size: int,
    incremental_iterations: int,
    seed: int,
    stage_label: str,
    side_label: str,
    direction_value: int,
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
        if 'direction' not in X_chunk.columns:
            raise SystemExit('direction is required for LONG/SHORT incremental training.')
        mask = X_chunk['direction'] == direction_value
        if not bool(mask.any()):
            continue
        X_chunk = X_chunk.loc[mask].copy()
        y_chunk = y_chunk.loc[mask].copy()

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
            f'[{stage_label}][{side_label}] model {member_idx}/{total_members} '
            f'chunk {trained_chunks + 1} ({len(y_chunk)} rows)'
        )
        next_model.fit(X_chunk, y_chunk, **fit_kwargs)
        model = next_model
        trained_chunks += 1
        trained_rows += len(y_chunk)

    if model is None:
        raise SystemExit('No training rows found. Check labels or input file.')

    print(
        f'[{stage_label}][{side_label}] model {member_idx}/{total_members} done: '
        f'chunks={trained_chunks}, rows={trained_rows}'
    )
    return model, feature_order, cat_feature_indexes


def train_incremental_catboost(
    train_input: str,
    test_input: str,
    model_base: str,
    direction_value: int,
    side_label: str,
    chunk_size: int,
    incremental_iterations: int,
    ensemble: bool,
    seed: int,
) -> None:
    members = 5 if ensemble else 1
    model_infos: list[tuple[object, list[str], list[int]]] = []

    for i in range(members):
        member_seed = seed + i
        model, feature_order, cat_feature_indexes = fit_incremental_catboost_model(
            input_path=train_input,
            chunk_size=chunk_size,
            incremental_iterations=incremental_iterations,
            seed=member_seed,
            stage_label='Train',
            side_label=side_label,
            direction_value=direction_value,
            member_idx=i + 1,
            total_members=members,
        )
        model_infos.append((model, feature_order, cat_feature_indexes))

    eval_rows = 0
    y_true_all: list[np.ndarray] = []
    y_prob_all: list[np.ndarray] = []
    y_pred_all: list[np.ndarray] = []
    for chunk in iter_dataset_chunks(test_input, chunk_size):
        X_chunk, y_chunk = prepare_features(chunk)
        if X_chunk.empty:
            continue
        if 'direction' not in X_chunk.columns:
            raise SystemExit('direction is required for LONG/SHORT incremental training.')
        mask = X_chunk['direction'] == direction_value
        if not bool(mask.any()):
            continue
        X_chunk = X_chunk.loc[mask].copy()
        y_chunk = y_chunk.loc[mask].copy()

        probs_per_model = []
        for model, feature_order, _cat_feature_indexes in model_infos:
            X_eval = align_features(X_chunk.copy(), feature_order)
            probs_per_model.append(model.predict_proba(X_eval)[:, 1])

        avg_prob = np.mean(np.vstack(probs_per_model), axis=0)
        y_pred = (avg_prob >= 0.5).astype(int)
        y_true_all.append(y_chunk.to_numpy())
        y_prob_all.append(avg_prob)
        y_pred_all.append(y_pred)
        eval_rows += len(y_chunk)

    if not y_true_all:
        raise SystemExit(f'No test rows found in --test-input for {side_label}.')

    y_true = np.concatenate(y_true_all)
    y_prob = np.concatenate(y_prob_all)
    y_pred = np.concatenate(y_pred_all)
    print(f'Incremental eval rows [{side_label}]: {eval_rows}')
    metrics = compute_binary_metrics(y_true, y_pred)
    print(
        f'Incremental metrics [{side_label}]: '
        f"accuracy={metrics['accuracy']:.4f} "
        f"precision={metrics['precision']:.4f} "
        f"recall={metrics['recall']:.4f} "
        f"f1={metrics['f1']:.4f}"
    )
    try:
        print(f'ROC AUC [{side_label}]:', roc_auc_score(y_true, y_prob))
    except ValueError:
        print(f'ROC AUC [{side_label}]: n/a')
    print_threshold_table(y_true, y_prob)

    prod_models: list[object] = []
    for i, (model, feature_order, cat_feature_indexes) in enumerate(model_infos):
        member_seed = seed + i
        updated_model, _feature_order, _cat_features = fit_incremental_catboost_model(
            input_path=test_input,
            chunk_size=chunk_size,
            incremental_iterations=incremental_iterations,
            seed=member_seed,
            stage_label='Prod finetune',
            side_label=side_label,
            direction_value=direction_value,
            member_idx=i + 1,
            total_members=members,
            init_model=model,
            feature_order=feature_order,
            cat_feature_indexes=cat_feature_indexes,
        )
        prod_models.append(updated_model)

    if ensemble:
        for idx, model in enumerate(prod_models, start=1):
            path = f'{model_base}.{side_label}.model{idx}.joblib'
            pipeline = Pipeline(
                steps=[
                    ('preprocess', 'passthrough'),
                    ('model', model),
                ]
            )
            joblib.dump(pipeline, path)
            print('Prod model saved:', path)
    else:
        model_path = f'{model_base}.{side_label}.joblib'
        pipeline = Pipeline(
            steps=[
                ('preprocess', 'passthrough'),
                ('model', prod_models[0]),
            ]
        )
        joblib.dump(pipeline, model_path)
        print('Prod model saved:', model_path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True, help='Path to CSV or JSONL')
    parser.add_argument('--strategy', default='default')
    parser.add_argument('--model', default='')
    parser.add_argument('--test-input', default='', help='Optional test CSV or JSONL')
    parser.add_argument('--test-days', type=int, default=30, help='Hold out last N days for test')
    parser.add_argument(
        '--ensemble',
        action='store_true',
        help='Train 5 expanding-window models, eval on holdout, then retrain prod ensemble on all data',
    )
    parser.add_argument('--model-type', choices=['catboost', 'random_forest'], default='catboost')
    parser.add_argument(
        '--incremental',
        action='store_true',
        help='Incremental chunk training for catboost to lower peak memory usage',
    )
    parser.add_argument('--chunk-size', type=int, default=50_000)
    parser.add_argument('--incremental-iterations', type=int, default=30)
    parser.add_argument('--seed', type=int, default=42)
    args = parser.parse_args()
    print(f'Using model type: {args.model_type}')

    if args.incremental:
        if args.model_type != 'catboost':
            raise SystemExit('--incremental is supported only for --model-type catboost.')
        if not args.test_input:
            raise SystemExit('--incremental requires --test-input.')
        model_base = model_base_from_arg(args.model, args.strategy)
        ensure_parent_dir(model_base)
        clear_strategy_models(model_base)
        for side_label, direction_value in (('long', 1), ('short', 0)):
            print(f'=== Incremental training for {side_label.upper()} ===')
            train_incremental_catboost(
                train_input=args.input,
                test_input=args.test_input,
                model_base=model_base,
                direction_value=direction_value,
                side_label=side_label,
                chunk_size=args.chunk_size,
                incremental_iterations=args.incremental_iterations,
                ensemble=args.ensemble,
                seed=args.seed,
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

    if args.test_input:
        test_df = load_dataset(args.test_input)
        train_df = df[df['label'].notna()].copy()
        if train_df.empty:
            raise SystemExit('No training rows found in --input.')
        X_train, y_train = prepare_features(train_df)
        X_test, y_test = prepare_features(test_df)
        if X_test.empty:
            raise SystemExit('No test rows found in --test-input.')
        print(f'Dataset split source: external files (--input train, --test-input test)')
        print(f'Train rows: {len(y_train)}, Test rows: {len(y_test)}')
    else:
        train_df, test_df = split_last_days(df, args.test_days)
        X_train, y_train = prepare_features(train_df)
        X_test, y_test = prepare_features(test_df)

    model_base = model_base_from_arg(args.model, args.strategy)
    ensure_parent_dir(model_base)
    clear_strategy_models(model_base)

    for side_label, direction_value in (('long', 1), ('short', 0)):
        print(f'=== Training {side_label.upper()} models (direction={direction_value}) ===')
        side_train_df = filter_by_direction(train_df, direction_value)
        side_test_df = filter_by_direction(test_df, direction_value)
        if side_train_df.empty:
            raise SystemExit(f'No train rows for {side_label}.')
        if side_test_df.empty:
            raise SystemExit(f'No test rows for {side_label}.')

        X_train_side, y_train_side = prepare_features(side_train_df)
        X_test_side, y_test_side = prepare_features(side_test_df)

        side_total = len(y_train_side)
        side_pos = int((y_train_side == 1).sum())
        side_neg = int((y_train_side == 0).sum())
        if side_total < 100:
            print(f'Warning: tiny {side_label} train dataset ({side_total}).')
        if side_pos == 0 or side_neg == 0:
            raise SystemExit(f'Only one class present in {side_label} train set.')

        if args.ensemble:
            # Phase 1: Evaluate ensemble on holdout test using train-only data.
            eval_cutoffs = compute_ensemble_cutoffs(side_train_df)
            eval_models = []
            total_models = len(eval_cutoffs)
            train_ts = side_train_df['entryTimestamp'].astype('Int64')
            for idx, cutoff in enumerate(eval_cutoffs, start=1):
                bar_width = 20
                filled = int(bar_width * (idx - 1) / total_models)
                bar = '#' * filled + '-' * (bar_width - filled)
                sys.stdout.write(
                    f'\rEval ensemble progress [{side_label}] [{bar}] {idx - 1}/{total_models}'
                )
                sys.stdout.flush()
                mask = train_ts <= cutoff
                X_tr, y_tr = prepare_features(side_train_df[mask])
                pipeline = build_pipeline(X_tr, args.model_type)
                fit_pipeline(pipeline, X_tr, y_tr, args.model_type)
                eval_models.append((pipeline, cutoff))
                preprocess = pipeline.named_steps.get('preprocess')
                expected = list(getattr(preprocess, 'feature_names_in_', []))
                X_eval = align_features(X_test_side.copy(), expected)
                y_pred = pipeline.predict(X_eval)
                y_prob = pipeline.predict_proba(X_eval)[:, 1]
                print(f'\n== Eval [{side_label}] Model {idx} (<= {cutoff}) ==')
                print(classification_report(y_test_side, y_pred, digits=3))
                try:
                    print('ROC AUC:', roc_auc_score(y_test_side, y_prob))
                except ValueError:
                    print('ROC AUC: n/a')
            bar = '#' * bar_width
            sys.stdout.write(
                f'\rEval ensemble progress [{side_label}] [{bar}] {total_models}/{total_models}\n'
            )
            sys.stdout.flush()

            eval_probs = []
            for model, _cutoff in eval_models:
                preprocess = model.named_steps.get('preprocess')
                expected = list(getattr(preprocess, 'feature_names_in_', []))
                X_eval = align_features(X_test_side.copy(), expected)
                eval_probs.append(model.predict_proba(X_eval)[:, 1])
            avg_prob = np.mean(np.vstack(eval_probs), axis=0)
            y_pred = (avg_prob >= 0.5).astype(int)
            print(f'== Eval Ensemble [{side_label}] (avg prob, threshold=0.5) ==')
            print(classification_report(y_test_side, y_pred, digits=3))
            try:
                print('ROC AUC:', roc_auc_score(y_test_side, avg_prob))
            except ValueError:
                print('ROC AUC: n/a')
            print_threshold_table(y_test_side.to_numpy(), avg_prob)

            # Phase 2: Train prod ensemble on all labeled data (train + test).
            full_df = pd.concat([side_train_df, side_test_df], ignore_index=True)
            prod_cutoffs = compute_ensemble_cutoffs(full_df)
            prod_models = []
            total_models = len(prod_cutoffs)
            full_ts = full_df['entryTimestamp'].astype('Int64')
            for idx, cutoff in enumerate(prod_cutoffs, start=1):
                bar_width = 20
                filled = int(bar_width * (idx - 1) / total_models)
                bar = '#' * filled + '-' * (bar_width - filled)
                sys.stdout.write(
                    f'\rProd ensemble progress [{side_label}] [{bar}] {idx - 1}/{total_models}'
                )
                sys.stdout.flush()
                mask = full_ts <= cutoff
                X_tr, y_tr = prepare_features(full_df[mask])
                pipeline = build_pipeline(X_tr, args.model_type)
                fit_pipeline(pipeline, X_tr, y_tr, args.model_type)
                prod_models.append(pipeline)
            bar = '#' * bar_width
            sys.stdout.write(
                f'\rProd ensemble progress [{side_label}] [{bar}] {total_models}/{total_models}\n'
            )
            sys.stdout.flush()

            for idx, model in enumerate(prod_models, start=1):
                path = f'{model_base}.{side_label}.model{idx}.joblib'
                joblib.dump(model, path)
                print('Prod model saved:', path)
        else:
            # Eval single model on holdout.
            pipeline = build_pipeline(X_train_side, args.model_type)
            fit_pipeline(pipeline, X_train_side, y_train_side, args.model_type)

            preprocess = pipeline.named_steps.get('preprocess')
            expected = list(getattr(preprocess, 'feature_names_in_', []))
            X_eval = align_features(X_test_side.copy(), expected) if expected else X_test_side

            y_pred = pipeline.predict(X_eval)
            y_prob = pipeline.predict_proba(X_eval)[:, 1]

            print(f'== Eval Single [{side_label}] ==')
            print(classification_report(y_test_side, y_pred, digits=3))
            try:
                print('ROC AUC:', roc_auc_score(y_test_side, y_prob))
            except ValueError:
                print('ROC AUC: n/a')
            print_threshold_table(y_test_side.to_numpy(), y_prob)

            # Prod single model on all labeled data.
            full_df = pd.concat([side_train_df, side_test_df], ignore_index=True)
            X_full, y_full = prepare_features(full_df)
            prod_pipeline = build_pipeline(X_full, args.model_type)
            fit_pipeline(prod_pipeline, X_full, y_full, args.model_type)

            model_path = f'{model_base}.{side_label}.joblib'
            joblib.dump(prod_pipeline, model_path)
            print('Prod model saved:', model_path)


if __name__ == '__main__':
    main()
