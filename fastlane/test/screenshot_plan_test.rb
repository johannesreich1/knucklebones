require_relative "../lib/screenshot_plan"

FakeScreenshot = Struct.new(:id, :source_file_checksum, :state, :file_name) do
  def asset_delivery_state = { "state" => state }
  def complete? = state == "COMPLETE"
  def error? = state == "FAILED"
end

def assert(condition, message)
  raise message unless condition
end

def desired(count = 6)
  (1..count).map { |index| { name: format("%02d-shot.png", index), md5: format("%032x", index) } }
end

def complete(id, md5)
  FakeScreenshot.new(id, md5, "COMPLETE", "#{id}.png")
end

items = desired
exact = items.map.with_index { |item, index| complete("id-#{index}", item.fetch(:md5)) }
plan = KnucklebonesAppStore::ScreenshotPlan.build(desired: items, screenshots: exact)
assert(KnucklebonesAppStore::ScreenshotPlan.next_operation(plan: plan, remote_count: exact.length).first == :noop,
       "an exact inventory must be a no-op")

reversed = exact.reverse
plan = KnucklebonesAppStore::ScreenshotPlan.build(desired: items, screenshots: reversed)
assert(KnucklebonesAppStore::ScreenshotPlan.next_operation(plan: plan, remote_count: reversed.length).first == :reorder,
       "an exact reversed inventory must only reorder")

duplicate = exact + [complete("duplicate", items.first.fetch(:md5))]
plan = KnucklebonesAppStore::ScreenshotPlan.build(desired: items, screenshots: duplicate)
assert(plan.fetch(:stale).map(&:id) == ["duplicate"], "a duplicate remote checksum must be stale")

nine_remote = exact.drop(1) + (1..4).map { |index| complete("stale-#{index}", format("%032x", 100 + index)) }
plan = KnucklebonesAppStore::ScreenshotPlan.build(desired: items, screenshots: nine_remote)
assert(KnucklebonesAppStore::ScreenshotPlan.next_operation(plan: plan, remote_count: nine_remote.length).first == :upload,
       "a set below capacity must upload before deleting stale screenshots")

ten_remote = nine_remote + [complete("stale-5", format("%032x", 105))]
plan = KnucklebonesAppStore::ScreenshotPlan.build(desired: items, screenshots: ten_remote)
assert(KnucklebonesAppStore::ScreenshotPlan.next_operation(plan: plan, remote_count: ten_remote.length).first == :delete,
       "a full set must delete one stale target screenshot before uploading")

begin
  pending = [FakeScreenshot.new("pending", "", "AWAITING_UPLOAD", "pending.png")]
  KnucklebonesAppStore::ScreenshotPlan.build(desired: items, screenshots: pending)
  raise "a pending remote screenshot must fail closed"
rescue KnucklebonesAppStore::SafetyError
  # expected
end

inventory = [
  { "locale" => "en-US", "displayType" => "APP_IPHONE_67", "setId" => "target" },
  { "locale" => "en-US", "displayType" => "APP_IPAD_PRO_3GEN_129", "setId" => "ipad" },
  { "locale" => "de-DE", "displayType" => "APP_IPHONE_67", "setId" => "de" }
]
unrelated = KnucklebonesAppStore::ScreenshotPlan.unrelated_inventory(
  inventory, locale: "en-US", display_type: "APP_IPHONE_67"
)
assert(unrelated.map { |entry| entry.fetch("setId") } == %w[ipad de],
       "only the exact target locale and display type may be excluded from the postcondition")

first_token = KnucklebonesAppStore::ScreenshotPlan.confirmation_token(
  app_id: "6804966098", version: "1.0", locale: "en-US", desired: items, screenshots: exact
)
second_token = KnucklebonesAppStore::ScreenshotPlan.confirmation_token(
  app_id: "6804966098", version: "1.0", locale: "en-US", desired: items, screenshots: reversed
)
assert(first_token != second_token, "the confirmation token must bind remote order")

puts "App Store screenshot planner: all safety cases passed"
