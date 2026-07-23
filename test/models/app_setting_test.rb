require "test_helper"

class AppSettingTest < ActiveSupport::TestCase
  test "stores typed JSON values including false" do
    setting = AppSetting.create!(key: "features.support", value: false)

    assert_equal false, setting.reload.value
  end

  test "rejects secret-like keys" do
    setting = AppSetting.new(key: "telegram.token", value: "hidden")

    assert_not setting.valid?
    assert setting.errors.of_kind?(:key, :invalid)
  end
end
