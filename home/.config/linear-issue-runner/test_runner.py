import fcntl
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

RUNNER = Path(__file__).with_name('runner.py')


class RunnerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        subprocess.run(['git', 'init', '-b', 'main', str(self.repo)], check=True, capture_output=True)
        subprocess.run(['git', '-C', str(self.repo), '-c', 'user.name=Test',
                        '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false',
                        'commit', '--allow-empty', '-m', 'Initial'], check=True, capture_output=True)
        self.state = self.root / 'state'
        self.metadata = self.root / 'metadata.json'
        self.metadata.write_text(json.dumps(dict(url='https://linear.app/example/issue/EX-1/test',
            project_id='project', title='Test issue', labels=['ready-for-agent'], eligible=True, reason='Ready')))
        self.fake = self.root / 'codex'
        self.fake.write_text(f'''#!{sys.executable}
import json, pathlib, sys
args=sys.argv
output=pathlib.Path(args[args.index('-o')+1])
sys.stdin.read()
if '--output-schema' in args:
    output.write_text(pathlib.Path({str(self.metadata)!r}).read_text())
else:
    pathlib.Path('result.txt').write_text('work')
    output.write_text('一部完了')
print(json.dumps({{'type':'thread.started','thread_id':'test-session'}}))
''')
        self.fake.chmod(0o755)
        self.config = self.root / 'config.toml'
        self.config.write_text(f'workspace="example"\nstate_dir={json.dumps(str(self.state))}\ncodex={json.dumps(str(self.fake))}\n[[projects]]\nid="project"\nrepo={json.dumps(str(self.repo))}\n')

    def invoke(self, *args):
        return subprocess.run([sys.executable, str(RUNNER),
            'https://linear.app/example/issue/EX-1/test', '--config', str(self.config), *args],
            text=True, capture_output=True)

    def test_check_does_not_create_worktree(self):
        result = self.invoke('--check')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.repo / '.worktrees').exists())

    def test_worker_writes_only_in_worktree_and_keeps_report(self):
        result = self.invoke()
        self.assertEqual(result.returncode, 0, result.stderr)
        record = json.loads(next(self.state.glob('EX-1-*/run.json')).read_text())
        self.assertEqual(record['phase'], 'agent-exited')
        self.assertTrue((Path(record['worktree']) / 'result.txt').exists())
        self.assertFalse((self.repo / 'result.txt').exists())
        self.assertEqual(next(self.state.glob('EX-1-*/result.md')).read_text(), '一部完了')

    def test_same_issue_is_locked_and_released(self):
        self.state.mkdir()
        with (self.state / 'example-EX-1.lock').open('w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = self.invoke('--check')
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('already running', result.stderr)
        self.assertEqual(self.invoke('--check').returncode, 0)

    def test_wrong_os_and_unmapped_project_do_not_start_worker(self):
        original = json.loads(self.metadata.read_text())
        for changes in ({'labels': ['os:windows']}, {'project_id': 'other'}, {'eligible': False}):
            with self.subTest(changes=changes):
                data = original.copy()
                data.update(changes)
                self.metadata.write_text(json.dumps(data))
                self.assertNotEqual(self.invoke().returncode, 0)
                self.assertFalse((self.repo / '.worktrees').exists())

    def test_other_issue_lock_does_not_block_run(self):
        self.state.mkdir()
        with (self.state / 'example-EX-2.lock').open('w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = self.invoke('--check')
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_codex_failure_is_recorded_and_releases_lock(self):
        original = self.fake.read_text()
        self.fake.write_text(f'#!{sys.executable}\nimport sys\nsys.exit(9)\n')
        result = self.invoke('--check')
        self.assertNotEqual(result.returncode, 0)
        record = json.loads(next(self.state.glob('EX-1-*/run.json')).read_text())
        self.assertEqual(record['phase'], 'failed')
        self.assertIn('9', record['error'])
        self.fake.write_text(original)
        self.assertEqual(self.invoke('--check').returncode, 0)


if __name__ == '__main__':
    unittest.main()
