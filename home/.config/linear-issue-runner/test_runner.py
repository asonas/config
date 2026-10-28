import fcntl
import json
import os
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
        self.result = self.root / 'worker-result.json'
        self.result.write_text(json.dumps(dict(outcome='completed', summary='検証済み', report='実施内容と証拠')))
        self.fake = self.root / 'codex'
        self.fake.write_text(f'''#!{sys.executable}
import json, pathlib, sys, subprocess
args=sys.argv
output=pathlib.Path(args[args.index('-o')+1])
sys.stdin.read()
if output.name == 'issue.json':
    output.write_text(pathlib.Path({str(self.metadata)!r}).read_text())
elif output.name == 'delivery.json':
    subprocess.run(['git','add','result.txt'], check=True)
    if subprocess.run(['git','diff','--cached','--quiet']).returncode:
        subprocess.run(['git','-c','user.name=Test','-c','user.email=test@example.com','-c','commit.gpgsign=false','commit','-m','Fixture'],check=True)
    output.write_text(json.dumps({{'status':'published','pr_url':'https://github.com/example/repo/pull/1','comment_id':'11111111-1111-4111-8111-111111111111','reason':''}}))
else:
    pathlib.Path('result.txt').write_text('work')
    output.write_text(pathlib.Path({str(self.result)!r}).read_text())
print(json.dumps({{'type':'thread.started','thread_id':'22222222-2222-4222-8222-222222222222'}}))
''')
        self.fake.chmod(0o755)
        gh = self.root / 'gh'
        gh.write_text(f'''#!{sys.executable}
import json,subprocess
print(json.dumps(dict(url='https://github.com/example/repo/pull/1',headRefName=subprocess.check_output(['git','branch','--show-current'],text=True).strip(),headRefOid=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),isDraft=True,state='OPEN')))
''')
        gh.chmod(0o755)
        git = self.root / 'git'
        git.write_text(f'''#!{sys.executable}
import os,sys
if 'verify-commit' in sys.argv:
    sys.exit(0)
os.execv('/usr/bin/git', ['git'] + sys.argv[1:])
''')
        git.chmod(0o755)
        self.config = self.root / 'config.toml'
        self.config.write_text(f'workspace="example"\nstate_dir={json.dumps(str(self.state))}\ncodex={json.dumps(str(self.fake))}\n[[projects]]\nid="project"\nrepo={json.dumps(str(self.repo))}\n')

    def invoke(self, *args):
        return subprocess.run([sys.executable, str(RUNNER),
            'https://linear.app/example/issue/EX-1/test', '--config', str(self.config), *args],
            text=True, capture_output=True, env=dict(os.environ, PATH=str(self.root)+os.pathsep+os.environ['PATH']))

    def test_check_does_not_create_worktree(self):
        result = self.invoke('--check')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.repo / '.worktrees').exists())

    def test_worker_writes_only_in_worktree_and_keeps_report(self):
        result = self.invoke()
        self.assertEqual(result.returncode, 0, result.stderr)
        record = json.loads(next(self.state.glob('EX-1-*/run.json')).read_text())
        self.assertEqual(record['phase'], 'delivered')
        self.assertTrue((Path(record['worktree']) / 'result.txt').exists())
        self.assertFalse((self.repo / 'result.txt').exists())
        self.assertEqual(record['outcome'], 'completed')
        self.assertIn('実施内容と証拠', next(self.state.glob('EX-1-*/result.md')).read_text())

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

    def test_partial_and_blocked_have_distinct_exit_status(self):
        for outcome, code, label in [('partial', 2, '一部完了'), ('blocked', 3, 'ブロック')]:
            with self.subTest(outcome=outcome):
                self.result.write_text(json.dumps(dict(outcome=outcome, summary='前提不足', report='対象ホストが未指定')))
                result = self.invoke()
                self.assertEqual(result.returncode, code, result.stderr)
                self.assertIn(f'結果: {label}', result.stdout)
                records = [json.loads(p.read_text()) for p in self.state.glob('EX-1-*/run.json')]
                self.assertTrue(any(r.get('outcome') == outcome and r['phase'] == 'delivered' for r in records))

    def test_resume_keeps_worktree_and_session(self):
        self.assertEqual(self.invoke().returncode, 0)
        first = json.loads(next(self.state.glob('EX-1-*/run.json')).read_text())
        result = self.invoke('--note', 'Continue existing work')
        self.assertEqual(result.returncode, 0, result.stderr)
        records = [json.loads(p.read_text()) for p in self.state.glob('EX-1-*/run.json')]
        resumed = next(r for r in records if 'resumed_from' in r)
        self.assertEqual(resumed['worktree'], first['worktree'])
        self.assertEqual(resumed['session_id'], first['session_id'])

    def test_publish_only_reuses_report_without_worker(self):
        self.assertEqual(self.invoke().returncode, 0)
        self.result.write_text('invalid worker output')
        result = self.invoke('--publish-only')
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_resume_refuses_changed_branch(self):
        self.assertEqual(self.invoke().returncode, 0)
        first = json.loads(next(self.state.glob('EX-1-*/run.json')).read_text())
        subprocess.run(['git','-C',first['worktree'],'switch','-c','unrelated'],check=True,capture_output=True)
        result = self.invoke()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('branch changed', result.stderr)

    def test_delivery_failure_preserves_result_for_retry(self):
        original = self.fake.read_text()
        self.fake.write_text(original.replace("'status':'published'", "'status':'blocked'"))
        result = self.invoke()
        self.assertEqual(result.returncode, 1)
        record = json.loads(next(self.state.glob('EX-1-*/run.json')).read_text())
        self.assertEqual(record['phase'], 'failed')
        self.assertEqual(record['outcome'], 'completed')
        self.fake.write_text(original)
        self.assertEqual(self.invoke('--publish-only').returncode, 0)

    def test_invalid_report_is_failure_not_completion(self):
        self.result.write_text('{"outcome":"completed"}')
        result = self.invoke()
        self.assertEqual(result.returncode, 1)
        record = json.loads(next(self.state.glob('EX-1-*/run.json')).read_text())
        self.assertEqual(record['phase'], 'failed')
        self.assertNotIn('outcome', record)


if __name__ == '__main__':
    unittest.main()
