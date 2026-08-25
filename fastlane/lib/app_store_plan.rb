require "digest"
require "json"

module KnucklebonesAppStore
  module AppStorePlan
    APP_INFO_FIELDS = {
      "name" => :name,
      "subtitle" => :subtitle
    }.freeze
    VERSION_FIELDS = {
      "promotionalText" => :promotional_text,
      "keywords" => :keywords,
      "description" => :description
    }.freeze

    module_function

    def metadata_diff(desired:, remote:, fields:)
      desired.each_with_object({}) do |(json_name, value), changes|
        attribute = fields.fetch(json_name)
        current = remote.nil? ? nil : remote.public_send(attribute)
        changes[attribute] = { from: current, to: value } unless current == value
      end
    end

    def update_attributes(diff)
      diff.transform_values { |change| change.fetch(:to) }
    end

    def canonical_json(value)
      JSON.generate(canonical(value))
    end

    def confirmation_token(app_id:, version:, desired_snapshot:, remote_snapshot:)
      digest = Digest::SHA256.hexdigest(
        canonical_json(
          "appId" => app_id,
          "version" => version,
          "desired" => desired_snapshot,
          "remote" => remote_snapshot
        )
      )
      "#{app_id}:#{version}:#{digest}"
    end

    def canonical(value)
      case value
      when Hash
        value.keys.map(&:to_s).sort.each_with_object({}) do |key, result|
          original_key = value.key?(key) ? key : value.keys.find { |candidate| candidate.to_s == key }
          result[key] = canonical(value.fetch(original_key))
        end
      when Array
        value.map { |item| canonical(item) }
      when Symbol
        value.to_s
      else
        value
      end
    end
    private_class_method :canonical
  end
end
