require 'fileutils'
require 'minitest/autorun'
require 'open3'
require 'tmpdir'

class ApmApplyTest < Minitest::Test
  SCRIPT = File.expand_path('../home/bin/apm-apply', __dir__)

  def setup
    @root = Dir.mktmpdir('apm-apply-test-')
    @bin = File.join(@root, 'fake-bin')
    FileUtils.mkdir_p([@bin, File.join(@root, '.apm/instructions')])
    File.write(File.join(@root, '.apm/instructions/base.instructions.md'), "# Base\n")
    File.write(File.join(@bin, 'apm'), <<~SH)
      #!/bin/sh
      echo "$@" >> "$HOME/apm-calls"
      if [ "$1" = "compile" ]; then
        printf 'compiled claude\n' > CLAUDE.md
        printf 'compiled codex\n' > AGENTS.md
      fi
    SH
    FileUtils.chmod(0o755, File.join(@bin, 'apm'))
  end

  def teardown
    FileUtils.remove_entry(@root)
  end

  def test_compile_only_does_not_install_dependencies
    stdout, stderr, status = run_script('--compile-only')

    assert status.success?, stderr
    assert_equal "compile --local-only --single-agents --force-instructions --target claude,codex\n",
                 File.read(File.join(@root, 'apm-calls'))
    assert_equal "compiled claude\n", File.read(File.join(@root, '.claude/CLAUDE.md'))
    assert_equal "compiled codex\n", File.read(File.join(@root, '.codex/AGENTS.md'))
    assert_includes stdout, 'APM instructions compiled'
  end

  def test_instruction_watcher_is_postponed_and_compiles_only
    install_fake_watchexec
    _stdout, stderr, status = run_script('--watch-instructions')

    assert status.success?, stderr
    arguments = File.read(File.join(@root, 'watchexec-arguments'))
    assert_includes arguments, '--postpone'
    assert_includes arguments, '/instructions/**'
    assert_includes arguments, '--compile-only'
    refute_includes arguments, '/apm.yml'
  end

  def test_manifest_watcher_is_postponed_and_runs_full_apply_on_changes
    install_fake_watchexec
    _stdout, stderr, status = run_script('--watch-manifest')

    assert status.success?, stderr
    arguments = File.read(File.join(@root, 'watchexec-arguments'))
    assert_includes arguments, '/apm.yml'
    assert_includes arguments, '--postpone'
    refute_includes arguments, '--compile-only'
    refute_includes arguments, '/instructions/**'
  end

  private

  def install_fake_watchexec
    File.write(File.join(@bin, 'watchexec'), <<~SH)
      #!/bin/sh
      printf '%s\n' "$@" > "$HOME/watchexec-arguments"
    SH
    FileUtils.chmod(0o755, File.join(@bin, 'watchexec'))
  end

  def run_script(argument)
    env = {'HOME' => @root, 'PATH' => "#{@bin}:#{ENV.fetch('PATH')}"}
    Open3.capture3(env, RbConfig.ruby, SCRIPT, argument)
  end
end
