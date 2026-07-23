require "test_helper"

class RemnashopContractTest < ActiveSupport::TestCase
  test "RS-012 returns the preserved public plan catalog" do
    result = Integrations::RemnashopClient.new.public_plans

    assert_kind_of Hash, result
    assert_kind_of Array, result.fetch("plans")
  end
end
