import importlib.util
from pathlib import Path
import subprocess
import tarfile
import tempfile
import json
import unittest

spec = importlib.util.spec_from_file_location('retire_worktree', Path(__file__).with_name('retire-worktree.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ArchiveTest(unittest.TestCase):
    def test_shared_history_and_source_recovery(self):
        with tempfile.TemporaryDirectory(prefix='research-archive-') as temporary:
            root = Path(temporary).resolve()
            repo = root / 'repo'
            repo.mkdir()
            module.git(repo, 'init', '-q')
            (repo / '.gitignore').write_text('synthetic-fixtures/\n')
            (repo / 'synthetic-fixtures').mkdir()
            (repo / 'synthetic-fixtures/authored.json').write_text('{"source":true}')
            module.git(repo, 'add', '.gitignore')
            module.git(repo, 'add', '-f', 'synthetic-fixtures/authored.json')
            module.git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture')
            receipts = []
            for number in range(2):
                worktree = root / f'worktree-{number}'
                module.git(repo, 'worktree', 'add', '--detach', str(worktree), 'HEAD')
                (worktree / 'synthetic-fixtures/generated.json').write_text('[]')
                (worktree / 'candidate.py').write_text('exact_untracked_source = True\n')
                out = root / 'archives' / str(number)
                receipt = module.retire(repo, worktree, out, apply=True)
                self.assertEqual(receipt['status'], 'removed')
                self.assertFalse(worktree.exists())
                with tarfile.open(out / 'source.tar.gz') as archive:
                    self.assertIn('synthetic-fixtures/authored.json', archive.getnames())
                    self.assertNotIn('synthetic-fixtures/generated.json', archive.getnames())
                    self.assertEqual(archive.extractfile('candidate.py').read(), b'exact_untracked_source = True\n')
                reference = json.loads((out / 'history-reference.json').read_text())
                history = (out / reference['path']).resolve()
                self.assertEqual(module.sha_file(history), reference['sha256'])
                receipts.append(history)
            self.assertEqual(receipts[0], receipts[1])
            self.assertEqual(len(list((root / 'archives/shared-history').glob('*.bundle'))), 1)
            restored = root / 'restored'
            subprocess.run(['git', 'clone', '-q', str(receipts[0]), str(restored)], check=True)
            self.assertEqual((restored / 'synthetic-fixtures/authored.json').read_text(), '{"source":true}')


if __name__ == '__main__':
    unittest.main()
