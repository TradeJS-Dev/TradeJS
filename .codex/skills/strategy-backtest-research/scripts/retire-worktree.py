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


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args])


def sha_file(file):
    result = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def retire(repository, worktree, out, apply=False):
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
    status = git(worktree, 'status', '--porcelain=v1', '-z')
    patch = git(worktree, 'diff', 'HEAD', '--binary')
    staged = git(worktree, 'diff', '--cached', '--binary')
    files = set(git(worktree, 'ls-files', '-z', '--cached', '--others', '--exclude-standard').split(b'\0'))
    files.update(git(worktree, 'ls-files', '-z', '--others', '--ignored', '--exclude-standard').split(b'\0'))
    generated = {'node_modules', 'dist', 'build', '.yarn', '.turbo', '.next', 'coverage', '__pycache__'}
    selected = []
    for raw in sorted(files):
        if not raw:
            continue
        name = os.fsdecode(raw)
        relative = Path(name)
        if relative.is_absolute() or '..' in relative.parts:
            raise ValueError('Invalid source path')
        if any(part in generated for part in relative.parts):
            continue
        if (relative.name == '.env' or relative.name.startswith('.env.') and relative.suffix not in {'.example', '.sample', '.template'}):
            raise ValueError('Preserve local credentials separately before removing this worktree')
        file = worktree / relative
        if file.is_symlink() or file.is_file():
            selected.append((name, None if file.is_symlink() else sha_file(file)))
    plan = {'worktree': str(worktree), 'repository': str(repository), 'head': head,
            'registration': record, 'sourceFiles': len(selected), 'dirty': bool(status), 'archive': str(out)}
    if not apply:
        return {**plan, 'status': 'planned'}
    # A cwd or any open source file means this checkout is still in use.
    opened = subprocess.run(['lsof', '-F', 'pcn', '+D', str(worktree)], capture_output=True)
    if opened.returncode != 1:
        raise ValueError('Worktree has open files or cannot be inspected: ' + opened.stdout.decode()[:500])
    out.mkdir(parents=True, exist_ok=False)
    git(worktree, 'bundle', 'create', str(out / 'history.bundle'), 'HEAD')
    git(repository, 'bundle', 'verify', str(out / 'history.bundle'))
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
    args = parser.parse_args()
    print(json.dumps(retire(args.repository, args.worktree, args.out, args.apply), indent=2))
