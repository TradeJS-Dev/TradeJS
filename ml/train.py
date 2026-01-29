import argparse
import json
import os
from typing import Tuple

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.metrics import classification_report, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder
from sklearn.ensemble import RandomForestClassifier

from ml.features import expand_features, drop_raw_columns


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

    df = expand_features(df)

    y = df['label'].astype(int)
    df = drop_raw_columns(df)
    X = df.drop(columns=[c for c in ['label', 'signalId'] if c in df.columns])

    return X, y


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
    parser.add_argument('--seed', type=int, default=42)
    args = parser.parse_args()

    df = load_dataset(args.input)
    X, y = prepare_features(df)

    if X.empty:
        raise SystemExit('No training rows found. Check labels or input file.')

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=args.test_size,
        random_state=args.seed,
        stratify=y,
    )

    pipeline = build_pipeline(X)
    pipeline.fit(X_train, y_train)

    y_pred = pipeline.predict(X_test)
    y_prob = pipeline.predict_proba(X_test)[:, 1]

    print(classification_report(y_test, y_pred, digits=3))
    try:
        print('ROC AUC:', roc_auc_score(y_test, y_prob))
    except ValueError:
        print('ROC AUC: n/a')

    model_path = args.model or f'data/ml/models/{args.strategy}.joblib'
    os.makedirs(os.path.dirname(model_path), exist_ok=True)
    joblib.dump(pipeline, model_path)
    print('Model saved:', model_path)


if __name__ == '__main__':
    main()
