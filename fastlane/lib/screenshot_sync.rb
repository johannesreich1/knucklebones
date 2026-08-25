require "deliver/app_screenshot"
require "digest/md5"
require "open3"
require "pathname"
require "spaceship"
require "timeout"
require_relative "app_store_plan"
require_relative "screenshot_plan"

module KnucklebonesAppStore
  class ScreenshotSync
    EDITABLE_VERSION_STATES = %w[
      PREPARE_FOR_SUBMISSION
      INVALID_BINARY
      REJECTED
      METADATA_REJECTED
      DEVELOPER_REJECTED
    ].freeze
    EDITABLE_APP_INFO_STATES = %w[
      PREPARE_FOR_SUBMISSION
      REJECTED
      DEVELOPER_REJECTED
    ].freeze
    REQUIRED_LOCALES = %w[de-DE en-GB fr-FR].freeze
    REQUIRED_DISPLAY_TYPES = %w[APP_IPAD_PRO_3GEN_129 APP_IPHONE_67].freeze

    attr_reader :config, :manifest, :metadata

    def initialize(config:, manifest:, metadata:, repository_root:, screenshot_root:, logger: nil)
      @config = config
      @manifest = manifest
      @metadata = metadata
      @repository_root = repository_root
      @screenshot_root = screenshot_root
      @logger = logger || ->(_message) {}
      validate_contract!
    end

    def desired(locale: nil, display_type: nil)
      return desired_targets.flat_map { |target| target.fetch(:desired) } if locale.nil? && display_type.nil?

      target = desired_targets.find do |candidate|
        candidate.fetch(:locale) == locale && candidate.fetch(:display_type) == display_type
      end
      raise SafetyError, "unknown screenshot target #{locale.inspect} #{display_type.inspect}" if target.nil?
      target.fetch(:desired)
    end

    def desired_targets
      @desired_targets ||= locale_configs.flat_map do |locale_config|
        screenshot_target_configs.map do |target_config|
          locale = locale_config.fetch("appStoreLocale")
          display_type = target_config.fetch("displayType")
          directory = File.join(
            @screenshot_root,
            locale_config.fetch("screenshotExportRoot"),
            target_config.fetch("exportDirectory")
          )
          files = @manifest.fetch("slides").map do |slide|
            name = format("%02d-%s.png", slide.fetch("index"), slide.fetch("slug"))
            file = File.join(directory, name)
            raise SafetyError, "missing screenshot export #{relative_path(file)}" unless File.file?(file)
            calculated = Deliver::AppScreenshot.calculate_display_type(file)
            unless calculated == display_type
              raise SafetyError, "#{relative_path(file)} maps to #{calculated.inspect}, expected #{display_type}"
            end
            { name: name, path: file, md5: Digest::MD5.file(file).hexdigest }
          end
          {
            locale: locale,
            runtime_locale: locale_config.fetch("runtimeLocale"),
            target_id: target_config.fetch("id"),
            display_type: display_type,
            directory: directory,
            desired: files
          }
        end
      end
    end

    def plan!(version_string:)
      require_committed_upload_inputs!
      build_plan(discover!(version_string: version_string))
    end

    def sync!(version_string:, confirmation:)
      initial = plan!(version_string: version_string)
      unless confirmation == initial.fetch(:token)
        raise SafetyError, "upload confirmation does not match the current read-only App Store plan"
      end

      new_app_info_locales = initial.fetch(:localizations).filter_map do |entry|
        entry.fetch(:locale) if entry.fetch(:create_app_info)
      end
      new_version_locales = initial.fetch(:localizations).filter_map do |entry|
        entry.fetch(:locale) if entry.fetch(:create_version)
      end
      protected_before = protected_snapshot(
        initial.fetch(:context),
        exclude_app_info_locales: new_app_info_locales,
        exclude_version_locales: new_version_locales
      )

      create_missing_localizations!(initial)
      after_create_context = wait_for_localizations!(
        version_string,
        app_info_locales: REQUIRED_LOCALES,
        version_locales: REQUIRED_LOCALES
      )
      after_create = build_plan(after_create_context, require_token: false)
      ensure_existing_owned_metadata_unchanged!(initial, after_create)
      ensure_protected_unchanged!(
        protected_before,
        after_create.fetch(:context),
        new_app_info_locales,
        new_version_locales
      )
      ensure_managed_screenshots_unchanged!(initial.fetch(:context), after_create.fetch(:context), "localization creation")
      ensure_created_localization_side_effects_confirmed!(initial, after_create)

      update_metadata!(after_create)
      after_metadata = wait_for_metadata_exact!(
        version_string,
        protected_before,
        new_app_info_locales,
        new_version_locales
      )
      ensure_managed_screenshots_unchanged!(initial.fetch(:context), after_metadata.fetch(:context), "metadata update")

      expected_set_ids = after_metadata.fetch(:targets).to_h do |target|
        key = [target.fetch(:locale), target.fetch(:display_type)]
        [key, sync_target!(target)]
      end

      final = wait_for_final_exact!(
        version_string,
        expected_set_ids,
        protected_before,
        new_app_info_locales,
        new_version_locales
      )

      { synced: true, locales: REQUIRED_LOCALES.length, targets: final.fetch(:targets).length,
        screenshots: final.fetch(:targets).sum { |target| target.fetch(:screenshots).length } }
    end

    private

    def validate_contract!
      raise SafetyError, "app-store-connect.json must use schemaVersion 2" unless @config.fetch("schemaVersion") == 2
      raise SafetyError, "manifest.json must use schemaVersion 2" unless @manifest.fetch("schemaVersion") == 2
      raise SafetyError, "metadata.json must use schemaVersion 1" unless @metadata.fetch("schemaVersion") == 1
      raise SafetyError, "only the iOS platform is supported" unless @config.fetch("platform") == "IOS"
      raise SafetyError, "metadataFile must be metadata.json" unless @config.fetch("metadataFile") == "metadata.json"
      raise SafetyError, "draftSyncApproved must be a boolean" unless [true, false].include?(@config.fetch("draftSyncApproved"))
      unless @config.fetch("reviewSubmissionApproved") == false
        raise SafetyError, "reviewSubmissionApproved must remain false for this draft-only sync"
      end

      locales = locale_configs.map { |entry| entry.fetch("appStoreLocale") }
      unless locales.sort == REQUIRED_LOCALES
        raise SafetyError, "configured App Store locales must be exactly #{REQUIRED_LOCALES.join(', ')}"
      end
      raise SafetyError, "configured App Store locales are duplicated" unless locales.uniq.length == locales.length

      runtime_locales = locale_configs.map { |entry| entry.fetch("runtimeLocale") }
      raise SafetyError, "runtime locales are duplicated" unless runtime_locales.uniq.length == runtime_locales.length
      locale_configs.each do |entry|
        %w[appStoreLocale runtimeLocale screenshotExportRoot].each { |key| nonempty_string!(entry, key, "locale config") }
        safe_relative_directory!(entry.fetch("screenshotExportRoot"), "screenshotExportRoot")
      end

      display_types = screenshot_target_configs.map { |entry| entry.fetch("displayType") }
      unless display_types.sort == REQUIRED_DISPLAY_TYPES
        raise SafetyError, "configured screenshot targets must be exactly #{REQUIRED_DISPLAY_TYPES.join(', ')}"
      end
      raise SafetyError, "configured screenshot display types are duplicated" unless display_types.uniq.length == display_types.length
      target_ids = screenshot_target_configs.map { |entry| entry.fetch("id") }
      raise SafetyError, "configured screenshot target ids are duplicated" unless target_ids.uniq.length == target_ids.length
      screenshot_target_configs.each do |entry|
        %w[id displayType exportDirectory].each { |key| nonempty_string!(entry, key, "screenshot target") }
        safe_relative_directory!(entry.fetch("exportDirectory"), "exportDirectory")
        raise SafetyError, "screenshot target width must be positive" unless entry.fetch("width").is_a?(Integer) && entry.fetch("width").positive?
        raise SafetyError, "screenshot target height must be positive" unless entry.fetch("height").is_a?(Integer) && entry.fetch("height").positive?
      end

      validate_manifest_targets!
      validate_manifest_localizations!
      validate_metadata!
    rescue KeyError => error
      raise SafetyError, "incomplete App Store delivery contract: #{error.message}"
    end

    def validate_manifest_targets!
      targets = @manifest.fetch("targets")
      raise SafetyError, "manifest targets must be an array" unless targets.is_a?(Array)
      screenshot_target_configs.each do |configured|
        matches = targets.select { |candidate| candidate.fetch("id") == configured.fetch("id") }
        raise SafetyError, "manifest target #{configured.fetch('id')} must exist exactly once" unless matches.one?
        manifest_target = matches.first
        %w[displayType width height].each do |field|
          unless manifest_target.fetch(field) == configured.fetch(field)
            raise SafetyError, "manifest target #{configured.fetch('id')} disagrees on #{field}"
          end
        end
      end
      raise SafetyError, "manifest contains an unmanaged screenshot target" unless targets.length == screenshot_target_configs.length
    end

    def validate_manifest_localizations!
      slides = @manifest.fetch("slides")
      raise SafetyError, "manifest slides must be a non-empty array" unless slides.is_a?(Array) && !slides.empty?
      indexes = slides.map { |slide| slide.fetch("index") }
      slugs = slides.map { |slide| slide.fetch("slug") }
      raise SafetyError, "manifest slide indexes must be unique" unless indexes.uniq.length == indexes.length
      raise SafetyError, "manifest slide slugs must be unique" unless slugs.uniq.length == slugs.length
      unless slugs.all? { |slug| slug.is_a?(String) && slug.match?(/\A[a-z0-9]+(?:-[a-z0-9]+)*\z/) }
        raise SafetyError, "manifest slide slugs must be safe filename components"
      end

      localizations = @manifest.fetch("localizations")
      raise SafetyError, "manifest localizations must be an object" unless localizations.is_a?(Hash)
      unless localizations.keys.sort == REQUIRED_LOCALES
        raise SafetyError, "manifest localizations must be exactly #{REQUIRED_LOCALES.join(', ')}"
      end
      locale_configs.each do |configured|
        locale = configured.fetch("appStoreLocale")
        localization = localizations.fetch(locale)
        unless localization.fetch("runtimeLocale") == configured.fetch("runtimeLocale")
          raise SafetyError, "manifest runtime locale disagrees for #{locale}"
        end
        localized_slides = localization.fetch("slides")
        raise SafetyError, "localized slides for #{locale} must be an object" unless localized_slides.is_a?(Hash)
        unless localized_slides.keys.sort == slugs.sort
          raise SafetyError, "localized slides for #{locale} must cover every manifest slug exactly"
        end
      end
    end

    def validate_metadata!
      localizations = @metadata.fetch("localizations")
      raise SafetyError, "metadata localizations must be an object" unless localizations.is_a?(Hash)
      unless localizations.keys.sort == REQUIRED_LOCALES
        raise SafetyError, "metadata localizations must be exactly #{REQUIRED_LOCALES.join(', ')}"
      end

      allowed = (AppStorePlan::APP_INFO_FIELDS.keys + AppStorePlan::VERSION_FIELDS.keys).sort
      owned_fields = @metadata.fetch("ownedFields")
      unless owned_fields.is_a?(Array) && owned_fields.all? { |field| field.is_a?(String) } && owned_fields.sort == allowed
        raise SafetyError, "metadata ownedFields must be exactly #{allowed.join(', ')}"
      end
      localizations.each do |locale, values|
        raise SafetyError, "metadata for #{locale} must be an object" unless values.is_a?(Hash)
        unknown = values.keys - allowed
        raise SafetyError, "metadata for #{locale} contains unowned fields: #{unknown.sort.join(', ')}" unless unknown.empty?
        values.each { |field, _value| nonempty_string!(values, field, "metadata for #{locale}") }
        raise SafetyError, "metadata for #{locale} must include name so App Info localization can be created" unless values.key?("name")

        maximums = { "name" => 30, "subtitle" => 30, "promotionalText" => 170, "description" => 4000 }
        maximums.each do |field, maximum|
          next unless values.key?(field)
          raise SafetyError, "#{locale} #{field} exceeds Apple's #{maximum}-character limit" if values.fetch(field).length > maximum
        end
        if values.key?("keywords") && values.fetch("keywords").bytesize > 100
          raise SafetyError, "#{locale} keywords exceed Apple's 100-byte limit"
        end
      end
    end

    def nonempty_string!(object, key, owner)
      value = object.fetch(key)
      raise SafetyError, "#{owner} #{key} must be a non-empty string" unless value.is_a?(String) && !value.strip.empty?
    end

    def safe_relative_directory!(value, owner)
      path = Pathname.new(value)
      unsafe_part = path.each_filename.any? { |part| part == "." || part == ".." }
      if path.absolute? || unsafe_part || value.include?("\\")
        raise SafetyError, "#{owner} must be a safe repository-relative directory"
      end
    end

    def locale_configs
      value = @config.fetch("locales")
      raise SafetyError, "config locales must be an array" unless value.is_a?(Array)
      value
    end

    def screenshot_target_configs
      value = @config.fetch("screenshotTargets")
      raise SafetyError, "config screenshotTargets must be an array" unless value.is_a?(Array)
      value
    end

    def desired_metadata(locale)
      values = @metadata.fetch("localizations").fetch(locale)
      {
        app_info: values.select { |key, _value| AppStorePlan::APP_INFO_FIELDS.key?(key) },
        version: values.select { |key, _value| AppStorePlan::VERSION_FIELDS.key?(key) }
      }
    end

    def build_plan(context, require_token: true)
      localization_plans = REQUIRED_LOCALES.map do |locale|
        desired = desired_metadata(locale)
        app_info_localization = context.fetch(:app_info_localizations)[locale]
        version_localization = context.fetch(:version_localizations)[locale]
        {
          locale: locale,
          create_app_info: app_info_localization.nil?,
          create_version: version_localization.nil?,
          app_info_localization: app_info_localization,
          version_localization: version_localization,
          app_info_diff: AppStorePlan.metadata_diff(
            desired: desired.fetch(:app_info), remote: app_info_localization, fields: AppStorePlan::APP_INFO_FIELDS
          ),
          version_diff: AppStorePlan.metadata_diff(
            desired: desired.fetch(:version), remote: version_localization, fields: AppStorePlan::VERSION_FIELDS
          )
        }
      end

      target_plans = desired_targets.map do |target|
        localization = context.fetch(:version_localizations)[target.fetch(:locale)]
        set = context.fetch(:target_sets)[[target.fetch(:locale), target.fetch(:display_type)]]
        screenshots = set.nil? ? [] : (set.app_screenshots || [])
        target.merge(
          localization: localization,
          target_set: set,
          screenshots: screenshots,
          plan: ScreenshotPlan.build(desired: target.fetch(:desired), screenshots: screenshots)
        )
      end

      result = { context: context, localizations: localization_plans, targets: target_plans }
      if require_token
        result[:token] = AppStorePlan.confirmation_token(
          app_id: @config.fetch("appleAppId"),
          version: context.fetch(:version).version_string,
          desired_snapshot: desired_snapshot,
          remote_snapshot: remote_snapshot(context)
        )
      end
      result
    end

    def desired_snapshot
      {
        "captureProvenanceSha256" => Digest::SHA256.file(File.join(@screenshot_root, "capture-provenance.json")).hexdigest,
        "metadata" => REQUIRED_LOCALES.to_h { |locale| [locale, desired_metadata(locale)] },
        "screenshots" => desired_targets.map do |target|
          {
            "locale" => target.fetch(:locale),
            "displayType" => target.fetch(:display_type),
            "files" => target.fetch(:desired).map { |item| { "name" => item.fetch(:name), "md5" => item.fetch(:md5) } }
          }
        end
      }
    end

    def remote_snapshot(context)
      {
        "appInfoLocalizations" => context.fetch(:app_info_records),
        "versionLocalizations" => context.fetch(:version_records),
        "screenshotSets" => context.fetch(:inventory)
      }
    end

    def metadata_exact?(plan)
      plan.fetch(:localizations).all? do |entry|
        !entry.fetch(:create_app_info) && !entry.fetch(:create_version) &&
          entry.fetch(:app_info_diff).empty? && entry.fetch(:version_diff).empty?
      end
    end

    def screenshot_targets_exact?(plan)
      plan.fetch(:targets).all? do |target|
        operation = ScreenshotPlan.next_operation(
          plan: target.fetch(:plan), remote_count: target.fetch(:screenshots).length
        )
        operation.first == :noop
      end
    end

    def wait_for_localizations!(version_string, app_info_locales:, version_locales:, seconds: 180, interval: 2)
      wait_until!("new App Store localizations did not become visible", seconds: seconds, interval: interval) do
        context = discover!(version_string: version_string)
        app_info_visible = app_info_locales.all? { |locale| context.fetch(:app_info_localizations).key?(locale) }
        version_visible = version_locales.all? { |locale| context.fetch(:version_localizations).key?(locale) }
        context if app_info_visible && version_visible && target_screenshots_terminal?(context)
      end
    end

    def target_screenshots_terminal?(context)
      context.fetch(:target_sets).each_value do |set|
        ScreenshotPlan.validate_remote!(set.app_screenshots || [])
      end
      true
    rescue SafetyError
      false
    end

    def wait_for_metadata_exact!(version_string, protected_before, new_app_info_locales, new_version_locales,
                                 seconds: 180, interval: 2)
      wait_until!("localized metadata did not converge before screenshot upload", seconds: seconds, interval: interval) do
        plan = build_plan(discover!(version_string: version_string), require_token: false)
        ensure_protected_unchanged!(
          protected_before, plan.fetch(:context), new_app_info_locales, new_version_locales
        )
        plan if metadata_exact?(plan)
      end
    end

    def wait_for_final_exact!(version_string, expected_set_ids, protected_before, new_app_info_locales,
                              new_version_locales, seconds: 180, interval: 2)
      wait_until!("App Store metadata or screenshots did not converge", seconds: seconds, interval: interval) do
        plan = build_plan(discover!(version_string: version_string), require_token: false)
        ensure_protected_unchanged!(
          protected_before, plan.fetch(:context), new_app_info_locales, new_version_locales
        )
        set_ids_exact = plan.fetch(:targets).all? do |target|
          key = [target.fetch(:locale), target.fetch(:display_type)]
          set = target.fetch(:target_set)
          if set && set.id.to_s != expected_set_ids.fetch(key)
            raise SafetyError, "screenshot set identity changed for #{target_label(target)}"
          end
          set && set.id.to_s == expected_set_ids.fetch(key)
        end
        plan if set_ids_exact && metadata_exact?(plan) && screenshot_targets_exact?(plan)
      end
    end

    def wait_until!(timeout_message, seconds:, interval:)
      deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + seconds
      loop do
        result = yield
        return result unless result.nil? || result == false
        raise SafetyError, "#{timeout_message} within #{seconds} seconds" if Process.clock_gettime(Process::CLOCK_MONOTONIC) >= deadline
        sleep interval if interval.positive?
      end
    end

    def create_missing_localizations!(plan)
      app_info = plan.fetch(:context).fetch(:app_info)
      version = plan.fetch(:context).fetch(:version)
      plan.fetch(:localizations).each do |entry|
        locale = entry.fetch(:locale)
        desired = desired_metadata(locale)
        if entry.fetch(:create_app_info)
          @logger.call("Creating App Info localization #{locale}")
          app_info.create_app_info_localization(
            attributes: localization_creation_attributes(locale, desired.fetch(:app_info))
          )
        end
        if entry.fetch(:create_version)
          @logger.call("Creating iOS version localization #{locale}")
          version.create_app_store_version_localization(
            attributes: localization_creation_attributes(locale, desired.fetch(:version))
          )
        end
      end
    end

    def localization_creation_attributes(locale, desired)
      { locale: locale }.merge(desired.to_h { |field, value| [field.to_sym, value] })
    end

    def ensure_existing_owned_metadata_unchanged!(initial, current)
      initial_by_locale = initial.fetch(:localizations).to_h { |entry| [entry.fetch(:locale), entry] }
      current.fetch(:localizations).each do |entry|
        before = initial_by_locale.fetch(entry.fetch(:locale))
        unless before.fetch(:create_app_info)
          before_values = owned_values(before.fetch(:app_info_localization), AppStorePlan::APP_INFO_FIELDS)
          current_values = owned_values(entry.fetch(:app_info_localization), AppStorePlan::APP_INFO_FIELDS)
          raise SafetyError, "App Info metadata for #{entry.fetch(:locale)} changed after confirmation" unless before_values == current_values
        end
        unless before.fetch(:create_version)
          before_values = owned_values(before.fetch(:version_localization), AppStorePlan::VERSION_FIELDS)
          current_values = owned_values(entry.fetch(:version_localization), AppStorePlan::VERSION_FIELDS)
          raise SafetyError, "version metadata for #{entry.fetch(:locale)} changed after confirmation" unless before_values == current_values
        end
      end
    end

    def ensure_created_localization_side_effects_confirmed!(initial, current)
      initial_by_locale = initial.fetch(:localizations).to_h { |entry| [entry.fetch(:locale), entry] }
      current.fetch(:localizations).each do |entry|
        before = initial_by_locale.fetch(entry.fetch(:locale))
        desired = desired_metadata(entry.fetch(:locale))
        if before.fetch(:create_app_info) && !created_values_exact?(
          entry.fetch(:app_info_localization), desired.fetch(:app_info), AppStorePlan::APP_INFO_FIELDS
        )
          raise SafetyError, "App Info metadata created for #{entry.fetch(:locale)} differs from the confirmed values; rerun the read-only plan"
        end
        if before.fetch(:create_version) && !created_values_exact?(
          entry.fetch(:version_localization), desired.fetch(:version), AppStorePlan::VERSION_FIELDS
        )
          raise SafetyError, "version metadata created for #{entry.fetch(:locale)} differs from the confirmed values; rerun the read-only plan"
        end
      end
    end

    def desired_owned_values(desired, fields)
      desired.to_h { |field, value| [fields.fetch(field), value] }
    end

    def current_desired_owned_values(localization, desired, fields)
      desired_owned_values(desired, fields).keys.to_h do |attribute|
        [attribute, localization&.public_send(attribute)]
      end
    end

    def created_values_exact?(localization, desired, fields)
      desired_owned_values(desired, fields) == current_desired_owned_values(localization, desired, fields)
    end

    def managed_screenshot_inventory(context)
      locale_configs.flat_map do |locale|
        screenshot_target_configs.map do |target|
          locale_name = locale.fetch("appStoreLocale")
          display_type = target.fetch("displayType")
          set = context.fetch(:target_sets)[[locale_name, display_type]]
          {
            "locale" => locale_name,
            "displayType" => display_type,
            "screenshots" => (set&.app_screenshots || []).map { |shot| ScreenshotPlan.screenshot_record(shot) }
          }
        end
      end
    end

    def ensure_managed_screenshots_unchanged!(before_context, after_context, phase)
      before = AppStorePlan.canonical_json(managed_screenshot_inventory(before_context))
      after = AppStorePlan.canonical_json(managed_screenshot_inventory(after_context))
      return if before == after

      raise SafetyError, "managed screenshot inventory changed during #{phase}; rerun the read-only plan"
    end

    def owned_values(localization, fields)
      fields.values.to_h { |attribute| [attribute, localization&.public_send(attribute)] }
    end

    def update_metadata!(plan)
      plan.fetch(:localizations).each do |entry|
        locale = entry.fetch(:locale)
        unless entry.fetch(:app_info_diff).empty?
          @logger.call("Updating owned App Info metadata for #{locale}")
          entry.fetch(:app_info_localization).update(
            attributes: AppStorePlan.update_attributes(entry.fetch(:app_info_diff))
          )
        end
        unless entry.fetch(:version_diff).empty?
          @logger.call("Updating owned iOS version metadata for #{locale}")
          entry.fetch(:version_localization).update(
            attributes: AppStorePlan.update_attributes(entry.fetch(:version_diff))
          )
        end
      end
    end

    def sync_target!(target)
      localization = target.fetch(:localization)
      raise SafetyError, "missing version localization for #{target_label(target)}" if localization.nil?
      set = target.fetch(:target_set)
      if set.nil?
        @logger.call("Creating screenshot set #{target_label(target)}")
        set = localization.create_app_screenshot_set(
          attributes: { screenshotDisplayType: target.fetch(:display_type) }
        )
      end
      raise SafetyError, "App Store Connect returned a screenshot set without an id" if set.nil? || set.id.to_s.empty?
      set = wait_for_set!(set.id, target_label(target))

      baseline = target.fetch(:screenshots).map { |shot| ScreenshotPlan.screenshot_record(shot) }
      current = (set.app_screenshots || []).map { |shot| ScreenshotPlan.screenshot_record(shot) }
      unless current == baseline
        raise SafetyError, "#{target_label(target)} changed after confirmation"
      end
      expected_order = baseline.map { |record| record.fetch("id") }
      deletable_ids = target.fetch(:plan).fetch(:stale).map { |shot| shot.id.to_s }

      operations = 0
      loop do
        operations += 1
        raise SafetyError, "#{target_label(target)} exceeded its bounded operation budget" if operations > 40

        set = wait_for_set!(set.id, target_label(target))
        screenshots = set.app_screenshots || []
        current_order = screenshots.map { |shot| shot.id.to_s }
        unless current_order == expected_order
          raise SafetyError, "#{target_label(target)} changed outside this confirmed sync"
        end
        plan = ScreenshotPlan.build(desired: target.fetch(:desired), screenshots: screenshots)
        operation, subject = ScreenshotPlan.next_operation(plan: plan, remote_count: screenshots.length)

        case operation
        when :upload
          @logger.call("Uploading #{target_label(target)} #{subject.fetch(:name)}")
          uploaded = set.upload_screenshot(path: subject.fetch(:path), wait_for_processing: false)
          if uploaded.nil? || uploaded.id.to_s.empty?
            raise SafetyError, "App Store Connect returned an uploaded screenshot without an id"
          end
          wait_complete!(uploaded.id)
          wait_terminal_in_set!(set, uploaded.id)
          expected_order << uploaded.id.to_s
        when :delete
          unless deletable_ids.include?(subject.id.to_s)
            raise SafetyError, "refusing to delete an unconfirmed screenshot from #{target_label(target)}"
          end
          @logger.call("Removing stale #{target_label(target)} screenshot #{subject.id}")
          subject.delete!
          wait_absent!(set, subject.id)
          expected_order.delete(subject.id.to_s)
          deletable_ids.delete(subject.id.to_s)
        when :reorder
          @logger.call("Applying manifest order to #{target_label(target)}")
          set = set.reorder_screenshots(app_screenshot_ids: subject)
          expected_order = subject
        when :noop
          break
        else
          raise SafetyError, "unknown screenshot operation #{operation.inspect}"
        end
      end
      set.id.to_s
    end

    def discover!(version_string:)
      app = Spaceship::ConnectAPI::App.get(app_id: @config.fetch("appleAppId"), includes: nil)
      unless app && app.id.to_s == @config.fetch("appleAppId") && app.bundle_id == @config.fetch("bundleId")
        raise SafetyError, "App Store Connect returned a different app than the configured id and bundle"
      end

      versions = app.get_app_store_versions(
        filter: { platform: Spaceship::ConnectAPI::Platform::IOS }, includes: nil, limit: nil, sort: nil
      )
      matches = versions.select do |version|
        state = version.app_version_state || version.app_store_state
        version.version_string == version_string && EDITABLE_VERSION_STATES.include?(state)
      end
      raise SafetyError, "expected exactly one editable iOS #{version_string} version, found #{matches.length}" unless matches.one?
      version = matches.first

      app_info = app.fetch_edit_app_info(includes: nil)
      if app_info.nil? || !EDITABLE_APP_INFO_STATES.include?(app_info.state || app_info.app_store_state)
        raise SafetyError, "expected one safely editable App Info record"
      end
      app_info_localizations = index_unique_localizations(
        app_info.get_app_info_localizations(filter: {}, includes: nil, limit: 200, sort: nil), "App Info"
      )
      version_localizations = index_unique_localizations(
        version.get_app_store_version_localizations(filter: {}, includes: nil, limit: 200, sort: nil), "version"
      )

      inventory = []
      target_sets = {}
      version_localizations.each_value do |localization|
        sets = localization.get_app_screenshot_sets(
          filter: {}, includes: "appScreenshots", limit: 200, sort: nil
        )
        seen_types = Hash.new(0)
        sets.each do |set|
          seen_types[set.screenshot_display_type] += 1
          shots = set.app_screenshots || []
          inventory << {
            "locale" => localization.locale,
            "displayType" => set.screenshot_display_type,
            "setId" => set.id.to_s,
            "screenshots" => shots.map { |shot| ScreenshotPlan.screenshot_record(shot) }
          }
          key = [localization.locale, set.screenshot_display_type]
          target_sets[key] = set if REQUIRED_LOCALES.include?(localization.locale) &&
                                    REQUIRED_DISPLAY_TYPES.include?(set.screenshot_display_type)
        end
        duplicates = seen_types.select { |_type, count| count > 1 }.keys
        unless duplicates.empty?
          raise SafetyError, "App Store Connect has duplicate screenshot sets for #{localization.locale}: #{duplicates.join(', ')}"
        end
      end
      inventory.sort_by! { |entry| [entry.fetch("locale"), entry.fetch("displayType"), entry.fetch("setId")] }

      {
        app: app,
        version: version,
        app_info: app_info,
        app_info_localizations: app_info_localizations,
        version_localizations: version_localizations,
        app_info_records: app_info_localizations.values.map { |item| app_info_record(item) }.sort_by { |item| item.fetch("locale") },
        version_records: version_localizations.values.map { |item| version_record(item) }.sort_by { |item| item.fetch("locale") },
        target_sets: target_sets,
        inventory: inventory
      }
    end

    def index_unique_localizations(localizations, owner)
      grouped = localizations.group_by(&:locale)
      duplicates = grouped.select { |_locale, items| items.length > 1 }.keys
      raise SafetyError, "App Store Connect has duplicate #{owner} localizations: #{duplicates.join(', ')}" unless duplicates.empty?
      grouped.transform_values(&:first)
    end

    def app_info_record(item)
      {
        "id" => item.id.to_s,
        "locale" => item.locale,
        "name" => item.name,
        "subtitle" => item.subtitle,
        "privacyPolicyUrl" => item.privacy_policy_url,
        "privacyChoicesUrl" => item.privacy_choices_url,
        "privacyPolicyText" => item.privacy_policy_text
      }
    end

    def version_record(item)
      {
        "id" => item.id.to_s,
        "locale" => item.locale,
        "description" => item.description,
        "keywords" => item.keywords,
        "marketingUrl" => item.marketing_url,
        "promotionalText" => item.promotional_text,
        "supportUrl" => item.support_url,
        "whatsNew" => item.whats_new
      }
    end

    def protected_snapshot(context, exclude_app_info_locales:, exclude_version_locales:)
      app_info = context.fetch(:app_info_records).filter_map do |record|
        locale = record.fetch("locale")
        next if exclude_app_info_locales.include?(locale)
        if REQUIRED_LOCALES.include?(locale)
          record.select { |key, _value| %w[locale privacyPolicyUrl privacyChoicesUrl privacyPolicyText].include?(key) }
        else
          record
        end
      end
      versions = context.fetch(:version_records).filter_map do |record|
        locale = record.fetch("locale")
        next if exclude_version_locales.include?(locale)
        if REQUIRED_LOCALES.include?(locale)
          record.select { |key, _value| %w[locale marketingUrl supportUrl whatsNew].include?(key) }
        else
          record
        end
      end
      screenshots = context.fetch(:inventory).reject do |entry|
        exclude_version_locales.include?(entry.fetch("locale")) ||
          (REQUIRED_LOCALES.include?(entry.fetch("locale")) && REQUIRED_DISPLAY_TYPES.include?(entry.fetch("displayType")))
      end
      { "appInfoLocalizations" => app_info, "versionLocalizations" => versions, "screenshotSets" => screenshots }
    end

    def ensure_protected_unchanged!(before, context, new_app_info_locales, new_version_locales)
      after = protected_snapshot(
        context,
        exclude_app_info_locales: new_app_info_locales,
        exclude_version_locales: new_version_locales
      )
      unless AppStorePlan.canonical_json(after) == AppStorePlan.canonical_json(before)
        raise SafetyError, "unowned App Store metadata, locale, or device inventory changed during sync"
      end
    end

    def wait_for_set!(id, label, seconds: 120, interval: 2)
      wait_until!("screenshot set #{label} did not become visible", seconds: seconds, interval: interval) do
        fetch_set_if_visible(id)
      end
    end

    def fetch_set_if_visible(id)
      Spaceship::ConnectAPI::AppScreenshotSet.get(
        app_screenshot_set_id: id, includes: "appScreenshots"
      )
    rescue Spaceship::UnexpectedResponse => error
      raise error unless not_found_response?(error)
      nil
    end

    def fetch_screenshot_if_visible(id)
      Spaceship::ConnectAPI.get_app_screenshot(app_screenshot_id: id).first
    rescue Spaceship::UnexpectedResponse => error
      raise error unless not_found_response?(error)
      nil
    end

    def not_found_response?(error)
      details = [error.message, (error.respond_to?(:error_info) ? error.error_info : nil)].compact.join(" ")
      details.match?(/(?:\b404\b|NOT_FOUND)/i)
    end

    def wait_complete!(id, seconds: 900)
      Timeout.timeout(seconds) do
        loop do
          shot = fetch_screenshot_if_visible(id)
          unless shot
            sleep 2
            next
          end
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
          fresh = wait_for_set!(set.id, "#{set.id}")
          return fresh unless (fresh.app_screenshots || []).any? { |shot| shot.id.to_s == id.to_s }
          sleep 2
        end
      end
    rescue Timeout::Error
      raise SafetyError, "deleted screenshot #{id} is still visible after #{seconds} seconds"
    end

    def wait_terminal_in_set!(set, id, seconds: 120)
      Timeout.timeout(seconds) do
        loop do
          fresh = wait_for_set!(set.id, "#{set.id}")
          shot = (fresh.app_screenshots || []).find { |candidate| candidate.id.to_s == id.to_s }
          if shot
            raise SafetyError, (["screenshot #{id} failed"] + shot.error_messages).join(": ") if shot.error?
            return fresh if shot.complete? && !ScreenshotPlan.checksum(shot).empty?
          end
          sleep 2
        end
      end
    rescue Timeout::Error
      raise SafetyError, "uploaded screenshot #{id} is not complete in its set after #{seconds} seconds"
    end

    def require_committed_upload_inputs!
      relative_root = relative_path(@screenshot_root)
      reviewed_paths = [relative_root, "fastlane", "Gemfile", "Gemfile.lock", "mise.toml", "package.json",
                        "tests/appstore-delivery.test.ts"]
      output, status = Open3.capture2e(
        "git", "-C", @repository_root, "status", "--short", "--untracked-files=all", "--", *reviewed_paths
      )
      raise SafetyError, "could not verify committed upload inputs: #{output.strip}" unless status.success?
      unless output.strip.empty?
        raise SafetyError, "commit every App Store metadata, marketing, and uploader input before planning a sync"
      end

      tracked = [
        "fastlane/Fastfile",
        "fastlane/lib/app_store_plan.rb",
        "fastlane/lib/screenshot_plan.rb",
        "fastlane/lib/screenshot_sync.rb",
        "fastlane/test/app_store_plan_test.rb",
        "fastlane/test/screenshot_plan_test.rb",
        "fastlane/test/screenshot_sync_contract_test.rb",
        "Gemfile",
        "Gemfile.lock",
        "mise.toml",
        "package.json",
        "tests/appstore-delivery.test.ts",
        File.join(relative_root, "app-store-connect.json"),
        File.join(relative_root, "manifest.json"),
        File.join(relative_root, "metadata.json"),
        File.join(relative_root, "capture-provenance.json"),
        *desired_targets.map { |target| relative_path(File.join(target.fetch(:directory), "checksums.txt")) },
        *desired.map { |item| relative_path(item.fetch(:path)) }
      ].uniq
      _tracked_output, tracked_status = Open3.capture2e(
        "git", "-C", @repository_root, "ls-files", "--error-unmatch", "--", *tracked
      )
      raise SafetyError, "App Store sync inputs must all be tracked by Git" unless tracked_status.success?
    end

    def target_label(target)
      "#{target.fetch(:locale)} #{target.fetch(:display_type)}"
    end

    def relative_path(path)
      path.delete_prefix("#{@repository_root}/")
    end
  end
end
