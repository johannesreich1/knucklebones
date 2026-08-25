require "json"

# Contract validation is pure. These placeholders keep the test independent of
# the network-installed Fastlane bundle while production still loads the real gems.
module Deliver
  class AppScreenshot; end
end
module Spaceship
  class UnexpectedResponse < StandardError
    attr_reader :error_info

    def initialize(error_info)
      @error_info = error_info
      super(error_info.to_s)
    end
  end
  class ConnectAPI; end
end
$LOADED_FEATURES << "deliver/app_screenshot.rb"
$LOADED_FEATURES << "spaceship.rb"

require_relative "../lib/screenshot_sync"

ContractScreenshot = Struct.new(:id, :source_file_checksum, :state, :file_name) do
  def asset_delivery_state = { "state" => state }
  def complete? = state == "COMPLETE"
  def error? = state == "FAILED"
end
ContractScreenshotSet = Struct.new(:app_screenshots)
ContractLocalization = Struct.new(
  :name, :subtitle, :promotional_text, :keywords, :description,
  keyword_init: true
)

class LocalizationCreationRecorder
  attr_reader :attributes

  def initialize
    @attributes = []
  end

  def create_app_info_localization(attributes:)
    @attributes << attributes
  end

  def create_app_store_version_localization(attributes:)
    @attributes << attributes
  end
end

ROOT = File.expand_path("../..", __dir__)
SCREENSHOT_ROOT = File.join(ROOT, "marketing", "app-store", "ios")

def assert(condition, message)
  raise message unless condition
end

def deep_copy(value)
  Marshal.load(Marshal.dump(value))
end

def safety_error(message)
  yield
  raise message
rescue KnucklebonesAppStore::SafetyError
  # expected
end

config = JSON.parse(File.read(File.join(SCREENSHOT_ROOT, "app-store-connect.json")))
manifest = JSON.parse(File.read(File.join(SCREENSHOT_ROOT, "manifest.json")))
metadata = JSON.parse(File.read(File.join(SCREENSHOT_ROOT, "metadata.json")))

sync = KnucklebonesAppStore::ScreenshotSync.new(
  config: config,
  manifest: manifest,
  metadata: metadata,
  repository_root: ROOT,
  screenshot_root: SCREENSHOT_ROOT
)
assert(sync.config.fetch("locales").length == 3, "the contract must own exactly three locales")
assert(sync.config.fetch("screenshotTargets").length == 2, "the contract must own exactly two device targets")

app_info_creator = LocalizationCreationRecorder.new
version_creator = LocalizationCreationRecorder.new
creation_plan = {
  context: { app_info: app_info_creator, version: version_creator },
  localizations: [{ locale: "de-DE", create_app_info: true, create_version: true }]
}
sync.send(:create_missing_localizations!, creation_plan)
assert(app_info_creator.attributes == [{
         locale: "de-DE",
         name: metadata.fetch("localizations").fetch("de-DE").fetch("name"),
         subtitle: metadata.fetch("localizations").fetch("de-DE").fetch("subtitle")
       }], "App Info creation must include Apple's required confirmed name and the confirmed subtitle")
assert(version_creator.attributes == [{
         locale: "de-DE",
         promotionalText: metadata.fetch("localizations").fetch("de-DE").fetch("promotionalText"),
         keywords: metadata.fetch("localizations").fetch("de-DE").fetch("keywords"),
         description: metadata.fetch("localizations").fetch("de-DE").fetch("description")
       }], "version localization creation must include only confirmed owned version fields")

de_metadata = metadata.fetch("localizations").fetch("de-DE")
initial_creation = {
  localizations: [{ locale: "de-DE", create_app_info: true, create_version: true }]
}
exact_creation = {
  localizations: [{
    locale: "de-DE",
    app_info_localization: ContractLocalization.new(name: de_metadata.fetch("name"), subtitle: de_metadata.fetch("subtitle")),
    version_localization: ContractLocalization.new(
      promotional_text: de_metadata.fetch("promotionalText"),
      keywords: de_metadata.fetch("keywords"),
      description: de_metadata.fetch("description")
    )
  }]
}
sync.send(:ensure_created_localization_side_effects_confirmed!, initial_creation, exact_creation)
mismatched_creation = deep_copy(exact_creation)
mismatched_creation.fetch(:localizations).first.fetch(:app_info_localization).name = "Unexpected Name"
safety_error("created metadata that differs from the confirmed POST must fail closed") do
  sync.send(:ensure_created_localization_side_effects_confirmed!, initial_creation, mismatched_creation)
end

missing_sets = { target_sets: {} }
empty_sets = {
  target_sets: { ["en-GB", "APP_IPHONE_67"] => ContractScreenshotSet.new([]) }
}
missing_inventory = sync.send(:managed_screenshot_inventory, missing_sets)
empty_inventory = sync.send(:managed_screenshot_inventory, empty_sets)
assert(missing_inventory == empty_inventory, "a missing managed set and an empty managed set must normalize identically")

changed_sets = {
  target_sets: {
    ["en-GB", "APP_IPHONE_67"] => ContractScreenshotSet.new([
      ContractScreenshot.new("new-id", "0123456789abcdef0123456789abcdef", "COMPLETE", "new.png")
    ])
  }
}
safety_error("managed screenshot changes after confirmation must fail closed") do
  sync.send(:ensure_managed_screenshots_unchanged!, missing_sets, changed_sets, "test phase")
end

visibility_checks = 0
eventual_sync = sync.dup
eventual_sync.define_singleton_method(:discover!) do |version_string:|
  raise "wrong version" unless version_string == "1.0"
  visibility_checks += 1
  visible = visibility_checks > 1
  locales = visible ? { "de-DE" => true, "en-GB" => true, "fr-FR" => true } : { "en-GB" => true }
  { app_info_localizations: locales, version_localizations: locales, target_sets: {} }
end
eventual_context = eventual_sync.send(
  :wait_for_localizations!, "1.0",
  app_info_locales: %w[de-DE en-GB fr-FR],
  version_locales: %w[de-DE en-GB fr-FR],
  seconds: 1,
  interval: 0
)
assert(visibility_checks == 2 && eventual_context.fetch(:version_localizations).key?("fr-FR"),
       "new localizations must be polled until App Store Connect exposes them")
assert(sync.send(:not_found_response?, Spaceship::UnexpectedResponse.new("status 404 NOT_FOUND")),
       "eventual-consistency polling must recognize an App Store Connect 404")
assert(!sync.send(:not_found_response?, Spaceship::UnexpectedResponse.new("status 403 FORBIDDEN")),
       "eventual-consistency polling must not hide authorization errors")

protected = sync.send(
  :protected_snapshot,
  {
    app_info_records: [
      { "id" => "en-info", "locale" => "en-GB", "name" => "Old", "subtitle" => "Old",
        "privacyPolicyUrl" => "https://example.test/privacy" },
      { "id" => "it-info", "locale" => "it-IT", "name" => "Keep Italian", "subtitle" => nil }
    ],
    version_records: [
      { "id" => "en-version", "locale" => "en-GB", "description" => "Old", "supportUrl" => "https://example.test" },
      { "id" => "it-version", "locale" => "it-IT", "description" => "Keep Italian", "supportUrl" => nil }
    ],
    inventory: [
      { "locale" => "en-GB", "displayType" => "APP_IPHONE_67", "setId" => "managed" },
      { "locale" => "en-GB", "displayType" => "APP_IPHONE_65", "setId" => "unmanaged" },
      { "locale" => "it-IT", "displayType" => "APP_IPHONE_67", "setId" => "italian" }
    ]
  },
  exclude_app_info_locales: [],
  exclude_version_locales: []
)
assert(protected.fetch("appInfoLocalizations").first.keys.sort == %w[locale privacyPolicyUrl],
       "owned App Info values must be excluded from the protected snapshot")
assert(protected.fetch("versionLocalizations").first.keys.sort == %w[locale supportUrl],
       "owned version values must be excluded from the protected snapshot")
assert(protected.fetch("screenshotSets").map { |entry| entry.fetch("setId") } == %w[unmanaged italian],
       "only the six exact managed screenshot targets may be excluded from preservation")

with_whats_new = deep_copy(metadata)
with_whats_new.fetch("localizations").fetch("en-GB")["whatsNew"] = "Initial release"
safety_error("version 1.0 What’s New must remain unowned") do
  KnucklebonesAppStore::ScreenshotSync.new(
    config: config, manifest: manifest, metadata: with_whats_new,
    repository_root: ROOT, screenshot_root: SCREENSHOT_ROOT
  )
end

with_url_owned = deep_copy(metadata)
with_url_owned.fetch("ownedFields") << "supportUrl"
safety_error("URL fields must remain unowned") do
  KnucklebonesAppStore::ScreenshotSync.new(
    config: config, manifest: manifest, metadata: with_url_owned,
    repository_root: ROOT, screenshot_root: SCREENSHOT_ROOT
  )
end

review_enabled = deep_copy(config)
review_enabled["reviewSubmissionApproved"] = true
safety_error("the draft sync must reject review submission approval") do
  KnucklebonesAppStore::ScreenshotSync.new(
    config: review_enabled, manifest: manifest, metadata: metadata,
    repository_root: ROOT, screenshot_root: SCREENSHOT_ROOT
  )
end

missing_locale = deep_copy(config)
missing_locale.fetch("locales").pop
safety_error("all configured locales must be required") do
  KnucklebonesAppStore::ScreenshotSync.new(
    config: missing_locale, manifest: manifest, metadata: metadata,
    repository_root: ROOT, screenshot_root: SCREENSHOT_ROOT
  )
end

wrong_target = deep_copy(config)
wrong_target.fetch("screenshotTargets").last["displayType"] = "APP_IPAD_PRO_129"
safety_error("the iPad display type must be exact") do
  KnucklebonesAppStore::ScreenshotSync.new(
    config: wrong_target, manifest: manifest, metadata: metadata,
    repository_root: ROOT, screenshot_root: SCREENSHOT_ROOT
  )
end

missing_slide = deep_copy(manifest)
missing_slide.fetch("localizations").fetch("fr-FR").fetch("slides").delete("neon-ladder")
safety_error("every locale must cover every slide") do
  KnucklebonesAppStore::ScreenshotSync.new(
    config: config, manifest: missing_slide, metadata: metadata,
    repository_root: ROOT, screenshot_root: SCREENSHOT_ROOT
  )
end

oversized_keywords = deep_copy(metadata)
oversized_keywords.fetch("localizations").fetch("de-DE")["keywords"] = "ü" * 51
safety_error("keyword validation must use UTF-8 bytes") do
  KnucklebonesAppStore::ScreenshotSync.new(
    config: config, manifest: manifest, metadata: oversized_keywords,
    repository_root: ROOT, screenshot_root: SCREENSHOT_ROOT
  )
end

puts "App Store sync contract: all fail-closed cases passed"
