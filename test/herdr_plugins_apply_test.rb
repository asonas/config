require 'fileutils'
require 'json'
require 'minitest/autorun'
require 'open3'
require 'tmpdir'

class HerdrPluginsApplyTest < Minitest::Test
  SCRIPT = File.expand_path('../home/bin/herdr-plugins-apply', __dir__)
  COMMIT = '0c1d940e9af09c632a48a5b179753ef25056ff13'

  def setup
    @root = Dir.mktmpdir('herdr-plugins-test-')
    @bin = File.join(@root, 'bin')
    FileUtils.mkdir_p(@bin)
  end

  def teardown
    FileUtils.remove_entry(@root)
  end

  def test_installs_the_pinned_plugin_when_missing
    install_fake_herdr([])

    _stdout, stderr, status = run_script

    assert status.success?, stderr
    assert_equal "plugin install shibayu36/herdr-equalize-panes --ref #{COMMIT} --yes\n",
                 File.read(File.join(@root, 'herdr-mutations'))
  end

  def test_leaves_the_enabled_pinned_plugin_unchanged
    install_fake_herdr([{enabled: true, source: {resolved_commit: COMMIT}}])

    stdout, stderr, status = run_script

    assert status.success?, stderr
    assert_includes stdout, 'is already at'
    refute_path_exists File.join(@root, 'herdr-mutations')
  end

  def test_enables_the_pinned_plugin_when_disabled
    install_fake_herdr([{enabled: false, source: {resolved_commit: COMMIT}}])

    _stdout, stderr, status = run_script

    assert status.success?, stderr
    assert_equal "plugin enable shibayu36.equalize-panes\n",
                 File.read(File.join(@root, 'herdr-mutations'))
  end

  def test_skips_the_headless_profile
    install_fake_herdr([])

    stdout, stderr, status = run_script({'MISE_ENV' => 'headless'})

    assert status.success?, stderr
    assert_includes stdout, 'headless profile'
    refute_path_exists File.join(@root, 'herdr-calls')
  end

  def test_reports_when_herdr_is_not_installed
    _stdout, stderr, status = run_script({}, path: @bin)

    refute status.success?
    assert_includes stderr, 'Herdr must be installed'
  end

  private

  def install_fake_herdr(plugins)
    payload = JSON.generate(id: 'cli:plugin', result: {plugins: plugins, type: 'plugin_list'})
    File.write(File.join(@bin, 'herdr'), <<~SH)
      #!/bin/sh
      echo "$@" >> "$HOME/herdr-calls"
      if [ "$1 $2" = "plugin list" ]; then
        printf '%s\n' '#{payload}'
      else
        echo "$@" >> "$HOME/herdr-mutations"
      fi
    SH
    FileUtils.chmod(0o755, File.join(@bin, 'herdr'))
  end

  def run_script(environment = {}, path: "#{@bin}:#{ENV.fetch('PATH')}")
    env = {'HOME' => @root, 'PATH' => path}.merge(environment)
    Open3.capture3(env, RbConfig.ruby, SCRIPT)
  end
end
