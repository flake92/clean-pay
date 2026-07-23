require "test_helper"

class Http044Test < ActionDispatch::IntegrationTest
  test "fails safely when a service worker build id is unavailable" do
    get "/service-worker.js"

    assert_response :service_unavailable
    assert_equal "Service worker build ID is unavailable", response.body
  end

  test "renders a build-scoped worker that caches no private routes" do
    runtime = Rails.application.config.x.clean_pay.runtime.with(
      build_id: "build-123"
    )
    config = config_with(runtime:)

    Rails.application.config.x.stub(:clean_pay, config) do
      get "/service-worker.js"
    end

    assert_response :success
    assert_equal "text/javascript", response.media_type
    assert_includes response.body, "clean-pay-shell-build-123"
    assert_includes response.body, "/offline"
    assert_not_includes response.body, "/cabinet"
    assert_not_includes response.body, "/payments"
    assert_equal "no-store", response.headers["Cache-Control"]
    assert_equal "/", response.headers["Service-Worker-Allowed"]
  end

  private

  def config_with(**overrides)
    original = Rails.application.config.x.clean_pay
    Object.new.tap do |wrapper|
      overrides.each do |name, value|
        wrapper.define_singleton_method(name) { value }
      end
      wrapper.define_singleton_method(:method_missing) do |name, *args, **kwargs,
        &block|
        original.public_send(name, *args, **kwargs, &block)
      end
    end
  end
end
