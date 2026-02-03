import argparse
import json
import os
import sys
from typing import Tuple

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.metrics import classification_report, roc_auc_score, precision_recall_fscore_support
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder
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


def build_pipeline(X: pd.DataFrame) -> Pipeline:
    categorical = [
        c
        for c in X.columns
        if X[c].dtype == 'object' and c not in ('strategyConfig',)
    ]
    numeric = [c for c in X.columns if c not in categorical]

    preprocessor = ColumnTransformer(
        transformers=[
            ('cat', OneHotEncoder(handle_unknown='ignore'), categorical),
            ('num', 'passthrough', numeric),
        ],
    )

    model = RandomForestClassifier(
        n_estimators=300,
        random_state=42,
        class_weight='balanced_subsample',
    )

    return Pipeline(
        steps=[
            ('preprocess', preprocessor),
            ('model', model),
        ]
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True, help='Path to CSV or JSONL')
    parser.add_argument('--strategy', default='default')
    parser.add_argument('--model', default='')
    parser.add_argument('--test-size', type=float, default=0.2)
    parser.add_argument('--test-input', default='', help='Optional test CSV or JSONL')
    parser.add_argument('--ensemble', action='store_true', help='Train 3 expanding-window models')
    parser.add_argument('--seed', type=int, default=42)
    args = parser.parse_args()

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
        X_train, y_train = X, y
        X_test, y_test = prepare_features(test_df)
    else:
        # Avoid identical feature rows leaking across train/test.
        groups = pd.util.hash_pandas_object(X, index=False)
        unique_groups = groups.unique()
        rng = np.random.RandomState(args.seed)
        rng.shuffle(unique_groups)
        test_group_count = int(len(unique_groups) * args.test_size)
        if test_group_count <= 0 or test_group_count >= len(unique_groups):
            X_train, X_test, y_train, y_test = train_test_split(
                X,
                y,
                test_size=args.test_size,
                random_state=args.seed,
                stratify=y,
            )
        else:
            test_groups = set(unique_groups[:test_group_count])
            test_mask = groups.isin(test_groups)
            X_train, X_test = X[~test_mask], X[test_mask]
            y_train, y_test = y[~test_mask], y[test_mask]

    def train_and_eval(model_tag: str, X_tr: pd.DataFrame, y_tr: pd.Series, show_table: bool) -> Pipeline:
        pipeline = build_pipeline(X_tr)
        pipeline.fit(X_tr, y_tr)
        preprocess = pipeline.named_steps.get('preprocess')
        expected = list(getattr(preprocess, 'feature_names_in_', []))
        X_eval = align_features(X_test.copy(), expected)
        y_pred = pipeline.predict(X_eval)
        y_prob = pipeline.predict_proba(X_eval)[:, 1]
        print(f'== {model_tag} ==')
        print(classification_report(y_test, y_pred, digits=3))
        try:
            print('ROC AUC:', roc_auc_score(y_test, y_prob))
        except ValueError:
            print('ROC AUC: n/a')
        if show_table:
            print_threshold_table(y_test.to_numpy(), y_prob)
        return pipeline

    if args.ensemble:
        if 'entryTimestamp' not in df.columns:
            raise SystemExit('entryTimestamp is required for ensemble training.')
        ts = df.loc[df['label'].notna(), 'entryTimestamp'].astype('Int64')
        if ts.isna().all():
            raise SystemExit('entryTimestamp is missing or invalid for ensemble training.')
        ts_values = ts.dropna().astype(int).to_numpy()
        t1, t2, t3, t4, t5 = np.quantile(ts_values, [0.4, 0.55, 0.7, 0.85, 1.0])
        cutoffs = [int(t1), int(t2), int(t3), int(t4), int(t5)]
        models = []
        total_models = len(cutoffs)
        for idx, cutoff in enumerate(cutoffs, start=1):
            bar_width = 20
            filled = int(bar_width * (idx - 1) / total_models)
            bar = '#' * filled + '-' * (bar_width - filled)
            sys.stdout.write(f'\rEnsemble progress [{bar}] {idx - 1}/{total_models}')
            sys.stdout.flush()
            mask = (df['entryTimestamp'].astype('Int64') <= cutoff) & df['label'].notna()
            X_tr, y_tr = prepare_features(df[mask])
            models.append(train_and_eval(f'Model {idx} (<= {cutoff})', X_tr, y_tr, False))
        bar = '#' * bar_width
        sys.stdout.write(f'\rEnsemble progress [{bar}] {total_models}/{total_models}\n')
        sys.stdout.flush()

        # Ensemble by averaging probabilities.
        probs = []
        for model in models:
            preprocess = model.named_steps.get('preprocess')
            expected = list(getattr(preprocess, 'feature_names_in_', []))
            X_eval = align_features(X_test.copy(), expected)
            probs.append(model.predict_proba(X_eval)[:, 1])
        avg_prob = np.mean(np.vstack(probs), axis=0)
        y_pred = (avg_prob >= 0.5).astype(int)
        print('== Ensemble (avg prob, threshold=0.5) ==')
        print(classification_report(y_test, y_pred, digits=3))
        try:
            print('ROC AUC:', roc_auc_score(y_test, avg_prob))
        except ValueError:
            print('ROC AUC: n/a')
        print_threshold_table(y_test.to_numpy(), avg_prob)

        model_base = args.model or f'data/ml/models/{args.strategy}'
        os.makedirs(os.path.dirname(model_base), exist_ok=True)
        for idx, model in enumerate(models, start=1):
            path = f'{model_base}.model{idx}.joblib'
            joblib.dump(model, path)
            print('Model saved:', path)
    else:
        pipeline = build_pipeline(X_train)
        pipeline.fit(X_train, y_train)

        preprocess = pipeline.named_steps.get('preprocess')
        expected = list(getattr(preprocess, 'feature_names_in_', []))
        if expected:
            X_test = align_features(X_test, expected)

        y_pred = pipeline.predict(X_test)
        y_prob = pipeline.predict_proba(X_test)[:, 1]

        print(classification_report(y_test, y_pred, digits=3))
        try:
            print('ROC AUC:', roc_auc_score(y_test, y_prob))
        except ValueError:
            print('ROC AUC: n/a')
        print_threshold_table(y_test.to_numpy(), y_prob)

        model_path = args.model or f'data/ml/models/{args.strategy}.joblib'
        os.makedirs(os.path.dirname(model_path), exist_ok=True)
        joblib.dump(pipeline, model_path)
        print('Model saved:', model_path)


if __name__ == '__main__':
    main()
