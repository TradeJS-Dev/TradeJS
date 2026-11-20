"""Focused boundary checks without loading optional training dependencies."""
import ast
import glob
import os
import re
import tempfile
import unittest
from collections import OrderedDict
from pathlib import Path
from threading import RLock
from types import SimpleNamespace
from unittest.mock import Mock


def functions(filename, names, scope):
    tree = ast.parse(Path(__file__).with_name(filename).read_text())
    nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    exec(compile(ast.Module(body=nodes, type_ignores=[]), filename, 'exec'), scope)
    return scope


class SecurityBoundaries(unittest.TestCase):
    def test_model_names_and_cache_budget(self):
        with tempfile.TemporaryDirectory() as root:
            loader = Mock(side_effect=lambda path: Path(path).name)
            scope = functions('api.py', {'_load_models', '_load_models_locked', '_cache_models'}, {
                'List': list, 'Any': object, 're': re, 'glob': glob, 'os': os,
                'MODEL_DIR': root, '_model_cache': OrderedDict(), '_model_lock': RLock(),
                '_MAX_CACHED_MODELS': 2, 'joblib': SimpleNamespace(load=loader),
            })
            for name in ['TrendLine', 'Range-Reclaim', 'Third']:
                Path(root, name + '.joblib').touch()
            for bad in ['../TrendLine', '/tmp/model', 'TrendLine/../TrendLine', '*', '']:
                with self.assertRaises(FileNotFoundError): scope['_load_models'](bad)
            self.assertEqual(loader.call_count, 0)
            self.assertEqual(scope['_load_models']('TrendLine'), ['TrendLine.joblib'])
            scope['_load_models']('TrendLine')
            self.assertEqual(loader.call_count, 1)
            scope['_load_models']('Range-Reclaim')
            scope['_load_models']('Third')
            self.assertEqual(list(scope['_model_cache']), ['Range-Reclaim', 'Third'])

    def test_report_escapes_feature_labels(self):
        from html import escape
        scope = functions('train.py', {'top_feature_threshold_html'}, {
            'pd': SimpleNamespace(DataFrame=object, Series=object), 'escape': escape,
            'top_feature_threshold_rows': lambda **kw: [{
                'feature': '<img src=x onerror=alert(1)>', 'direction': 'x<y',
                'threshold': 1, 'accuracy': .5, 'coverage': .8, 'rows': 10,
            }],
        })
        result = scope['top_feature_threshold_html'](SimpleNamespace(empty=False), object())
        self.assertNotIn('<img', result)
        self.assertIn('&lt;img', result)
        self.assertIn('x&lt;y', result)


if __name__ == '__main__': unittest.main()
