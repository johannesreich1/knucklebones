require "deliver/app_screenshot"
require "digest/md5"
require "open3"
require "spaceship"
require "timeout"
require_relative "screenshot_plan"

module KnucklebonesAppStore
  class ScreenshotSync
    EDITABLE_STATES = %w[
      PREPARE_FOR_SUBMISSION
      INVALID_BINARY
      REJECTED
      METADATA_REJECTED
      DEVELOPER_REJECTED
    ].freeze

    def initialize(config:, manifest:, repository_root:, screenshot_root:, logger: nil)
      @config = config
      @manifest = manifest
      @repository_root = repository_root
      @screenshot_root = screenshot_root
      @logger = logger || ->(_message) {}
    end

    def desired
      @desired ||= @manifest.fetch("slides").map do |slide|
        name = format("%02d-%s.png", slide.fetch("index"), slide.fetch("slug"))
        file = File.join(@screenshot_root, @config.fetch("exportDirectory"), name)
        display = Deliver::AppScreenshot.calculate_display_type(file)
        unless display == @config.fetch("screenshotDisplayType")
          raise SafetyError, "#{name} maps to #{display.inspect}, expected #{@config.fetch('screenshotDisplayType')}"
        end
        { name: name, path: file, md5: Digest::MD5.file(file).hexdigest }
      end
    end

    def plan!(version_string:, locale:)
      require_committed_upload_inputs!
      context = discover!(version_string: version_string, locale: locale)
      screenshots = context.fetch(:target_set)&.app_screenshots || []
      plan = ScreenshotPlan.build(desired: desired, screenshots: screenshots)
      token = ScreenshotPlan.confirmation_token(
        app_id: @config.fetch("appleAppId"),
        version: version_string,
        locale: locale,
        desired: desired,
        screenshots: screenshots
      )
      context.merge(plan: plan, token: token, screenshots: screenshots)
    end

    def sync!(version_string:, locale:, confirmation:)
      initial = plan!(version_string: version_string, locale: locale)
      raise SafetyError, "upload confirmation does not match the current read-only plan" unless confirmation == initial.fetch(:token)

      before_unrelated = ScreenshotPlan.unrelated_inventory(
        initial.fetch(:inventory), locale: locale, display_type: @config.fetch("screenshotDisplayType")
      )
      set = initial.fetch(:target_set)
      if set.nil?
        @logger.call("Creating the missing #{locale} #{@config.fetch('screenshotDisplayType')} set")
        set = initial.fetch(:localization).create_app_screenshot_set(
          attributes: { screenshotDisplayType: @config.fetch("screenshotDisplayType") }
        )
      end
      set = refresh_set(set)

      operations = 0
      loop do
        operations += 1
        raise SafetyError, "screenshot sync exceeded its bounded operation budget" if operations > 40

        set = refresh_set(set)
        screenshots = set.app_screenshots || []
        plan = ScreenshotPlan.build(desired: desired, screenshots: screenshots)
        operation, subject = ScreenshotPlan.next_operation(plan: plan, remote_count: screenshots.length)

        case operation
        when :upload
          @logger.call("Uploading #{subject.fetch(:name)}")
          uploaded = set.upload_screenshot(path: subject.fetch(:path), wait_for_processing: false)
          wait_complete!(uploaded.id)
        when :delete
          @logger.call("Removing stale target screenshot #{subject.id}")
          subject.delete!
          wait_absent!(set, subject.id)
        when :reorder
          @logger.call("Applying manifest order to the target screenshot set")
          set = set.reorder_screenshots(app_screenshot_ids: subject)
        when :noop
          break
        else
          raise SafetyError, "unknown screenshot operation #{operation.inspect}"
        end
      end

      final_set = refresh_set(set)
      final_screenshots = final_set.app_screenshots || []
      final_plan = ScreenshotPlan.build(desired: desired, screenshots: final_screenshots)
      final_operation = ScreenshotPlan.next_operation(plan: final_plan, remote_count: final_screenshots.length)
      raise SafetyError, "target screenshot set did not converge" unless final_operation.first == :noop

      after = discover!(version_string: version_string, locale: locale)
      after_set = after.fetch(:target_set)
      raise SafetyError, "target screenshot set disappeared during final verification" if after_set.nil?
      unless after_set.id.to_s == final_set.id.to_s
        raise SafetyError, "target screenshot set changed during final verification"
      end
      after_screenshots = after_set.app_screenshots || []
      after_plan = ScreenshotPlan.build(desired: desired, screenshots: after_screenshots)
      after_operation = ScreenshotPlan.next_operation(plan: after_plan, remote_count: after_screenshots.length)
      raise SafetyError, "rediscovered target screenshot set is not exact" unless after_operation.first == :noop

      after_unrelated = ScreenshotPlan.unrelated_inventory(
        after.fetch(:inventory), locale: locale, display_type: @config.fetch("screenshotDisplayType")
      )
      raise SafetyError, "an unrelated locale or device screenshot set changed during upload" unless after_unrelated == before_unrelated

      { uploaded: true, count: after_screenshots.length }
    end

    private

    def require_committed_upload_inputs!
      relative_root = @screenshot_root.delete_prefix("#{@repository_root}/")
      reviewed_paths = [
        relative_root,
        "fastlane/Fastfile",
        "fastlane/lib/screenshot_plan.rb",
        "fastlane/lib/screenshot_sync.rb",
        "Gemfile",
        "Gemfile.lock",
        "mise.toml",
        "package.json",
        "tests/appstore-delivery.test.ts"
      ]
      output, status = Open3.capture2e(
        "git", "-C", @repository_root, "status", "--short", "--untracked-files=all", "--", *reviewed_paths
      )
      raise SafetyError, "could not verify committed upload inputs: #{output.strip}" unless status.success?
      unless output.strip.empty?
        raise SafetyError, "commit every App Store marketing and uploader input before planning an upload"
      end

      tracked = [
        "fastlane/Fastfile",
        "fastlane/lib/screenshot_plan.rb",
        "fastlane/lib/screenshot_sync.rb",
        "Gemfile",
        "Gemfile.lock",
        "mise.toml",
        "package.json",
        "tests/appstore-delivery.test.ts",
        File.join(relative_root, "app-store-connect.json"),
        File.join(relative_root, "manifest.json"),
        File.join(relative_root, @config.fetch("exportDirectory"), "checksums.txt"),
        *desired.map { |item| item.fetch(:path).delete_prefix("#{@repository_root}/") }
      ]
      _tracked_output, tracked_status = Open3.capture2e(
        "git", "-C", @repository_root, "ls-files", "--error-unmatch", "--", *tracked
      )
      raise SafetyError, "upload inputs must all be tracked by Git" unless tracked_status.success?
    end

    def discover!(version_string:, locale:)
      app = Spaceship::ConnectAPI::App.get(app_id: @config.fetch("appleAppId"), includes: nil)
      unless app && app.id.to_s == @config.fetch("appleAppId") && app.bundle_id == @config.fetch("bundleId")
        raise SafetyError, "App Store Connect returned a different app than the configured id and bundle"
      end

      versions = app.get_app_store_versions(
        filter: { platform: Spaceship::ConnectAPI::Platform::IOS }, includes: nil, limit: nil, sort: nil
      )
      matches = versions.select do |version|
        state = version.app_version_state || version.app_store_state
        version.version_string == version_string && EDITABLE_STATES.include?(state)
      end
      raise SafetyError, "expected exactly one editable iOS #{version_string} version, found #{matches.length}" unless matches.one?
      version = matches.first

      localizations = version.get_app_store_version_localizations(
        filter: {}, includes: nil, limit: nil, sort: nil
      )
      localization = localizations.find { |candidate| candidate.locale == locale }
      raise SafetyError, "locale #{locale} does not already exist on App Store Connect" if localization.nil?

      inventory = []
      target_sets = []
      localizations.each do |candidate|
        sets = candidate.get_app_screenshot_sets(
          filter: {}, includes: "appScreenshots", limit: nil, sort: nil
        )
        sets.each do |set|
          shots = set.app_screenshots || []
          inventory << {
            "locale" => candidate.locale,
            "displayType" => set.screenshot_display_type,
            "setId" => set.id.to_s,
            "screenshots" => shots.map { |shot| ScreenshotPlan.screenshot_record(shot) }
          }
          if candidate.locale == locale && set.screenshot_display_type == @config.fetch("screenshotDisplayType")
            target_sets << set
          end
        end
      end
      raise SafetyError, "App Store Connect has duplicate target screenshot sets" if target_sets.length > 1

      inventory.sort_by! { |entry| [entry.fetch("locale"), entry.fetch("displayType"), entry.fetch("setId")] }
      {
        app: app,
        version: version,
        localization: localization,
        target_set: target_sets.first,
        inventory: inventory
      }
    end

    def refresh_set(set)
      Spaceship::ConnectAPI::AppScreenshotSet.get(
        app_screenshot_set_id: set.id, includes: "appScreenshots"
      )
    end

    def wait_complete!(id, seconds: 900)
      Timeout.timeout(seconds) do
        loop do
          shot = Spaceship::ConnectAPI.get_app_screenshot(app_screenshot_id: id).first
          return shot if shot.complete?
          raise SafetyError, (["screenshot #{id} failed"] + shot.error_messages).join(": ") if shot.error?
          sleep 2
        end
      end
    rescue Timeout::Error
      raise SafetyError, "screenshot #{id} did not finish within #{seconds} seconds"
    end

    def wait_absent!(set, id, seconds: 120)
      Timeout.timeout(seconds) do
        loop do
          fresh = refresh_set(set)
          return fresh unless (fresh.app_screenshots || []).any? { |shot| shot.id.to_s == id.to_s }
          sleep 2
        end
      end
    rescue Timeout::Error
      raise SafetyError, "deleted screenshot #{id} is still visible after #{seconds} seconds"
    end
  end
end
