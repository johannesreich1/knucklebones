require_relative "../lib/app_store_plan"

FakeLocalization = Struct.new(
  :name,
  :subtitle,
  :promotional_text,
  :keywords,
  :description,
  keyword_init: true
)

def assert(condition, message)
  raise message unless condition
end

remote = FakeLocalization.new(
  name: "Old Name",
  subtitle: "Tactical dice duels",
  promotional_text: "Old promotion",
  keywords: "dice,strategy",
  description: "Old description"
)

app_info_diff = KnucklebonesAppStore::AppStorePlan.metadata_diff(
  desired: { "name" => "Knucklebones Neon", "subtitle" => "Tactical dice duels" },
  remote: remote,
  fields: KnucklebonesAppStore::AppStorePlan::APP_INFO_FIELDS
)
assert(app_info_diff.keys == [:name], "metadata diff must contain only changed owned App Info fields")
assert(app_info_diff.fetch(:name) == { from: "Old Name", to: "Knucklebones Neon" },
       "metadata diff must expose the exact old and new values")

version_diff = KnucklebonesAppStore::AppStorePlan.metadata_diff(
  desired: { "promotionalText" => "New promotion", "keywords" => "dice,strategy" },
  remote: remote,
  fields: KnucklebonesAppStore::AppStorePlan::VERSION_FIELDS
)
assert(version_diff.keys == [:promotional_text],
       "metadata diff must contain only changed owned version fields")
assert(KnucklebonesAppStore::AppStorePlan.update_attributes(version_diff) == { promotional_text: "New promotion" },
       "update attributes must contain only the owned desired value")

missing_diff = KnucklebonesAppStore::AppStorePlan.metadata_diff(
  desired: { "description" => "Localized description" },
  remote: nil,
  fields: KnucklebonesAppStore::AppStorePlan::VERSION_FIELDS
)
assert(missing_diff == { description: { from: nil, to: "Localized description" } },
       "a missing localization must plan every present owned field from nil")

desired = {
  "metadata" => { "en-GB" => { "name" => "Knucklebones Neon" } },
  "screenshots" => [{ "locale" => "en-GB", "displayType" => "APP_IPHONE_67", "md5" => "abc" }]
}
remote_snapshot = {
  "versionLocalizations" => [{ "locale" => "en-GB", "whatsNew" => nil }],
  "screenshotSets" => []
}
token = KnucklebonesAppStore::AppStorePlan.confirmation_token(
  app_id: "6804966098", version: "1.0", desired_snapshot: desired, remote_snapshot: remote_snapshot
)
reordered_token = KnucklebonesAppStore::AppStorePlan.confirmation_token(
  app_id: "6804966098",
  version: "1.0",
  desired_snapshot: desired.transform_keys { |key| key },
  remote_snapshot: { "screenshotSets" => [], "versionLocalizations" => remote_snapshot.fetch("versionLocalizations") }
)
assert(token == reordered_token, "confirmation token must not depend on hash insertion order")

changed_remote_token = KnucklebonesAppStore::AppStorePlan.confirmation_token(
  app_id: "6804966098",
  version: "1.0",
  desired_snapshot: desired,
  remote_snapshot: {
    "versionLocalizations" => [{ "locale" => "en-GB", "whatsNew" => "Concurrent edit" }],
    "screenshotSets" => []
  }
)
assert(token != changed_remote_token, "confirmation token must bind even unowned remote metadata")

changed_desired_token = KnucklebonesAppStore::AppStorePlan.confirmation_token(
  app_id: "6804966098",
  version: "1.0",
  desired_snapshot: desired.merge("screenshots" => []),
  remote_snapshot: remote_snapshot
)
assert(token != changed_desired_token, "confirmation token must bind every desired screenshot target")
assert(token.match?(/\A6804966098:1\.0:[0-9a-f]{64}\z/), "confirmation token must be printable and scoped")

puts "App Store metadata planner: all safety cases passed"
