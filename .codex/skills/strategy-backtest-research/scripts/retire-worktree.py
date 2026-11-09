#!/usr/bin/env python3
"""Archive exact source state before removing an explicitly selected worktree."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile
import shutil
import tempfile


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args])


def sha_file(file):
    result = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def retire(repository, worktree, out, apply=False, history_root=None):
    repository, worktree, out = map(lambda p: Path(p).resolve(), (repository, worktree, out))
    records = git(repository, 'worktree', 'list', '--porcelain').decode().strip().split('\n\n')
    paths = [r.splitlines()[0].split(' ', 1)[1] for r in records]
    if str(worktree) not in paths or str(worktree) == paths[0]:
        raise ValueError('Select a registered secondary worktree, never the primary checkout')
    record = records[paths.index(str(worktree))]
    if '\nlocked' in record or not worktree.is_dir():
        raise ValueError('Worktree is locked or missing')
    if git(worktree, 'submodule', 'status').strip():
        raise ValueError('Archive submodules separately before removing this worktree')
    if worktree == out or worktree in out.parents:
        raise ValueError('Archive must be outside the removed worktree')
    head = git(worktree, 'rev-parse', 'HEAD').decode().strip()
    history_root = Path(history_root).resolve() if history_root else out.parent / 'shared-history'
    if history_root == worktree or worktree in history_root.parents:
        raise ValueError('Shared history must be outside the removed worktree')
    history = history_root / f'{head}.bundle'
    status = git(worktree, 'status', '--porcelain=v1', '-z')
    patch = git(worktree, 'diff', 'HEAD', '--binary')
    staged = git(worktree, 'diff', '--cached', '--binary')
    tracked = set(git(worktree, 'ls-files', '-z', '--cached').split(b'\0'))
    files = set(git(worktree, 'ls-files', '-z', '--cached', '--others', '--exclude-standard').split(b'\0'))
    files.update(git(worktree, 'ls-files', '-z', '--others', '--ignored', '--exclude-standard').split(b'\0'))
    generated = {'node_modules', 'dist', 'build', '.yarn', '.turbo', '.next', 'coverage', '__pycache__', 'synthetic-fixtures'}
    selected = []
    for raw in sorted(files):
        if not raw:
            continue
        name = os.fsdecode(raw)
        relative = Path(name)
        if relative.is_absolute() or '..' in relative.parts:
            raise ValueError('Invalid source path')
        if raw not in tracked and any(part in generated for part in relative.parts):
            continue
        if (relative.name == '.env' or relative.name.startswith('.env.') and relative.suffix not in {'.example', '.sample', '.template'}):
            raise ValueError('Preserve local credentials separately before removing this worktree')
        file = worktree / relative
        if file.is_symlink() or file.is_file():
            selected.append((name, None if file.is_symlink() else sha_file(file)))
    plan = {'worktree': str(worktree), 'repository': str(repository), 'head': head,
            'registration': record, 'sourceFiles': len(selected), 'dirty': bool(status), 'archive': str(out),
            'sharedHistoryBundle': str(history), 'reuseHistoryBundle': history.exists()}
    if not apply:
        return {**plan, 'status': 'planned'}
    # A cwd or any open source file means this checkout is still in use.
    opened = subprocess.run(['lsof', '-F', 'pcn', '+D', str(worktree)], capture_output=True)
    if opened.returncode != 1:
        raise ValueError('Worktree has open files or cannot be inspected: ' + opened.stdout.decode()[:500])
    out.mkdir(parents=True, exist_ok=False)
    history_root.mkdir(parents=True, exist_ok=True)
    if history.is_symlink():
        raise ValueError('Shared history must be a regular file')
    if not history.exists():
        handle, temporary = tempfile.mkstemp(prefix='history-', suffix='.bundle', dir=history_root)
        os.close(handle)
        try:
            git(worktree, 'bundle', 'create', temporary, 'HEAD')
            try:
                os.link(temporary, history)
            except FileExistsError:
                pass
        finally:
            os.unlink(temporary)
    git(repository, 'bundle', 'verify', str(history))
    if git(repository, 'bundle', 'list-heads', str(history), 'HEAD').decode().strip() != f'{head} HEAD':
        raise ValueError('Shared history HEAD does not match archived worktree')
    history_reference = {'path': os.path.relpath(history, out), 'sha256': sha_file(history), 'head': head}
    (out / 'history-reference.json').write_text(json.dumps(history_reference) + '\n')
    (out / 'working-tree.patch').write_bytes(patch)
    (out / 'staged.patch').write_bytes(staged)
    (out / 'status.porcelain').write_bytes(status)
    archive = out / 'source.tar.gz'
    with tarfile.open(archive, 'w:gz', dereference=False) as tar:
        for name, _ in selected:
            tar.add(worktree / name, arcname=name, recursive=False)
    with tarfile.open(archive, 'r:gz') as tar:
        for name, digest in selected:
            member = tar.getmember(name)
            file = worktree / name
            if member.issym():
                assert os.readlink(file) == member.linkname
            else:
                stream = tar.extractfile(member)
                archived = hashlib.file_digest(stream, 'sha256').hexdigest()
                assert archived == digest == sha_file(file), name
    if git(worktree, 'rev-parse', 'HEAD').decode().strip() != head or git(worktree, 'status', '--porcelain=v1', '-z') != status or git(worktree, 'diff', 'HEAD', '--binary') != patch:
        raise ValueError('Worktree changed during archival; leave it in place')
    receipt = {**plan, 'status': 'archived', 'sha256': {p.name: sha_file(p) for p in out.iterdir()}}
    target = out / 'receipt.json'
    target.write_text(json.dumps(receipt, indent=2) + '\n')
    try:
        git(repository, 'worktree', 'remove', *(['--force'] if status else []), str(worktree))
    except subprocess.CalledProcessError:
        # Git can remove the registration but leave an ignored dependency tree
        # behind on macOS. Only finish removal after registration is gone and
        # the exact source snapshot has already passed the checks above.
        remaining = git(repository, 'worktree', 'list', '--porcelain').decode()
        if f'worktree {worktree}\n' in remaining or worktree.is_symlink():
            raise
        if worktree.exists():
            shutil.rmtree(worktree)
    receipt['status'] = 'removed'
    target.write_text(json.dumps(receipt, indent=2) + '\n')
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repository', required=True)
    parser.add_argument('--worktree', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--history-root', help='Permanent shared Git-bundle directory; defaults to <out-parent>/shared-history')
    args = parser.parse_args()
    print(json.dumps(retire(args.repository, args.worktree, args.out, args.apply, args.history_root), indent=2))
