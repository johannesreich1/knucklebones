require "digest"
require "json"
require "set"

module KnucklebonesAppStore
  class SafetyError < StandardError; end

  module ScreenshotPlan
    MAX_SCREENSHOTS = 10

    module_function

    def delivery_state(screenshot)
      delivery = screenshot.respond_to?(:asset_delivery_state) ? screenshot.asset_delivery_state : nil
      return delivery["state"] if delivery.is_a?(Hash)
      return screenshot.state if screenshot.respond_to?(:state)
      nil
    end

    def complete?(screenshot)
      return screenshot.complete? if screenshot.respond_to?(:complete?)
      delivery_state(screenshot) == "COMPLETE"
    end

    def failed?(screenshot)
      return screenshot.error? if screenshot.respond_to?(:error?)
      delivery_state(screenshot) == "FAILED"
    end

    def checksum(screenshot)
      value = screenshot.source_file_checksum if screenshot.respond_to?(:source_file_checksum)
      value.to_s.downcase
    end

    def validate_remote!(screenshots)
      ids = screenshots.map { |shot| shot.id.to_s }
      raise SafetyError, "remote screenshot ids are not unique" unless ids.uniq.length == ids.length

      screenshots.each do |shot|
        if complete?(shot)
          raise SafetyError, "complete screenshot #{shot.id} has no source checksum" if checksum(shot).empty?
        elsif !failed?(shot)
          raise SafetyError,
                "screenshot #{shot.id} is in non-terminal state #{delivery_state(shot).inspect}; retry the plan later"
        end
      end
    end

    def build(desired:, screenshots:)
      desired_checksums = desired.map { |item| item.fetch(:md5) }
      raise SafetyError, "local screenshots are not checksum-unique" unless desired_checksums.uniq.length == desired.length
      raise SafetyError, "Apple accepts at most #{MAX_SCREENSHOTS} screenshots per set" if desired.length > MAX_SCREENSHOTS

      validate_remote!(screenshots)
      available = Hash.new { |hash, key| hash[key] = [] }
      screenshots.each { |shot| available[checksum(shot)] << shot if complete?(shot) }

      keepers = {}
      used_ids = Set.new
      desired.each do |item|
        keeper = available[item.fetch(:md5)].find { |shot| !used_ids.include?(shot.id.to_s) }
        next if keeper.nil?
        keepers[item.fetch(:md5)] = keeper
        used_ids << keeper.id.to_s
      end

      missing = desired.reject { |item| keepers.key?(item.fetch(:md5)) }
      stale = screenshots.reject { |shot| used_ids.include?(shot.id.to_s) }
      desired_ids = desired.filter_map { |item| keepers[item.fetch(:md5)]&.id&.to_s }
      current_ids = screenshots.map { |shot| shot.id.to_s }
      reorder = missing.empty? && stale.empty? && current_ids != desired_ids

      {
        keepers: keepers,
        missing: missing,
        stale: stale,
        desired_ids: desired_ids,
        current_ids: current_ids,
        reorder: reorder
      }
    end

    def next_operation(plan:, remote_count:)
      unless plan.fetch(:missing).empty?
        if remote_count >= MAX_SCREENSHOTS
          victim = plan.fetch(:stale).first
          raise SafetyError, "target set is full but has no safe stale screenshot to remove" if victim.nil?
          return [:delete, victim]
        end
        return [:upload, plan.fetch(:missing).first]
      end
      return [:delete, plan.fetch(:stale).first] unless plan.fetch(:stale).empty?
      return [:reorder, plan.fetch(:desired_ids)] if plan.fetch(:reorder)
      [:noop, nil]
    end

    def screenshot_record(screenshot)
      {
        "id" => screenshot.id.to_s,
        "checksum" => checksum(screenshot),
        "state" => delivery_state(screenshot),
        "fileName" => screenshot.respond_to?(:file_name) ? screenshot.file_name.to_s : ""
      }
    end

    def local_digest(desired)
      body = desired.map { |item| "#{item.fetch(:name)}:#{item.fetch(:md5)}" }.join("\n")
      Digest::SHA256.hexdigest(body)
    end

    def remote_digest(screenshots)
      Digest::SHA256.hexdigest(JSON.generate(screenshots.map { |shot| screenshot_record(shot) }))
    end

    def confirmation_token(app_id:, version:, locale:, desired:, screenshots:)
      [app_id, version, locale, local_digest(desired), remote_digest(screenshots)].join(":")
    end

    def unrelated_inventory(inventory, locale:, display_type:)
      inventory.reject do |entry|
        entry.fetch("locale") == locale && entry.fetch("displayType") == display_type
      end
    end
  end
end
