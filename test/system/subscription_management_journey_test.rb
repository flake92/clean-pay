require "application_system_test_case"

class SubscriptionManagementJourneyTest < ApplicationSystemTestCase
  SUBSCRIPTION = {
    "status" => "ACTIVE",
    "plan_name" => "Базовый",
    "url" => "https://subscription.example.test/connect/owner",
    "expire_at" => 30.days.from_now.iso8601,
    "device_limit" => 5,
    "traffic_limit" => "100 GB"
  }.freeze

  test "copies access evidence and manages devices, promo, reissue and extend" do
    user = create_web_user(remnashop_user_id: "subscription-owner")
    sign_in_browser(web_user: user, upstream: true)
    access = current_access
    devices = DeviceOperation.new
    actions = AccountOperation.new
    extension = extension_operation_for(user)

    Subscriptions::CurrentAccess.stub(:new, -> { access }) do
      visit cabinet_path
      assert_text SUBSCRIPTION.fetch("url")
      assert_selector(
        "[data-controller='clipboard']" \
        "[data-clipboard-text-value='#{SUBSCRIPTION.fetch('url')}']"
      )
      assert_button "Скопировать ссылку"

      Subscriptions::DeviceManagement.stub(:new, devices) do
        click_link "Устройства"
        assert_current_path subscription_devices_path
        assert_text "iPhone"
        click_button "Удалить"
        assert_current_path subscription_devices_path
        assert_text "Список устройств обновлён."
      end

      visit subscription_path
      assert_text "Статус: ACTIVE"

      Subscriptions::AccountActions.stub(:new, actions) do
        click_button "Перевыпустить ссылку"
        assert_text "Ссылка подписки перевыпущена."

        fill_in "Промокод", with: "PROMO-2026"
        click_button "Применить"
        assert_text "Промокод применён."
      end

      with_offers do
        visit extend_path
        Payments::CreateOperation.stub(:new, extension) do
          click_button "Продлить"
        end
      end
    end

    assert_equal [ "device-1" ], devices.deleted
    assert_equal 1, actions.reissues
    assert_equal [ "PROMO-2026" ], actions.promocodes
    assert_current_path payment_path(user.payment_operations.last)
    assert_text "Состояние платежа"
  end

  class DeviceOperation
    attr_reader :deleted

    def initialize
      @deleted = []
    end

    def list(**)
      {
        "devices" => [
          {
            "hwid" => "device-1",
            "platform" => "iOS",
            "device_model" => "iPhone"
          }
        ],
        "current_count" => 1,
        "max_count" => 5
      }
    end

    def delete(hwid:, **)
      deleted << hwid
      { "deleted" => true }
    end
  end

  class AccountOperation
    attr_reader :reissues, :promocodes

    def initialize
      @reissues = 0
      @promocodes = []
    end

    def reissue(**)
      @reissues += 1
      { "success" => true }
    end

    def activate_promocode(code:, **)
      promocodes << code
      { "success" => true }
    end
  end

  private

  def current_access
    Object.new.tap do |operation|
      operation.define_singleton_method(:call) { |**| SUBSCRIPTION }
    end
  end

  def extension_operation_for(user)
    operation = user.payment_operations.create!(
      kind: :extend,
      idempotency_key_hash: SecureRandom.hex(32),
      request_fingerprint: SecureRandom.hex(32),
      request_payload: { "duration_days" => 30 },
      upstream_key: SecureRandom.uuid
    )
    Object.new.tap do |creator|
      creator.define_singleton_method(:call!) do |kind:, web_session:, **|
        raise "wrong kind" unless kind == :extend
        raise "wrong owner" unless web_session.web_user_id == user.id

        Payments::CreateOperation::Result.new(
          operation:,
          payment: nil,
          replayed: false
        )
      end
    end
  end
end
