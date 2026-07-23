require "test_helper"

class SkeletonTest < ActiveSupport::TestCase
  test "boots the pinned Rails stack with the application defaults" do
    assert_equal "4.0.6", RUBY_VERSION
    assert_equal "8.1.3", Rails.version
    assert_equal :ru, I18n.default_locale
    assert_equal "UTC", Time.zone.name
  end

  test "exposes resourceful Rails inputs and 19 server-rendered pages" do
    routes = Rails.application.routes.routes

    assert_equal 67, routes.size
    assert_equal 18, routes.count { _1.defaults[:controller] == "pages" }
    assert_equal 1, routes.count { _1.defaults[:controller] == "supports" }
    assert_equal 2, routes.count { _1.defaults[:controller] == "pwa" }
    assert routes.any? {
      _1.verb == "DELETE" && _1.path.spec.to_s.start_with?(
        "/account/session"
      )
    }
    assert routes.none? { _1.path.spec.to_s.start_with?("/api/bff") }
    assert routes.none? { _1.defaults[:controller]&.start_with?("rails/") }
  end

  test "keeps tests outside the preserved development database" do
    database = ActiveRecord::Base.connection_db_config.database

    assert_equal "clean_pay_test", database
    refute_equal "clean_pay", database
  end
end
