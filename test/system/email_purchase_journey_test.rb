require "application_system_test_case"

class EmailPurchaseJourneyTest < ApplicationSystemTestCase
  test "registers, verifies, purchases, returns, opens cabinet and logs out" do
    user = create_web_user(email_verified: false)
    authentication = authentication_for(user)
    verification = verification_for(user)
    operation = payment_operation_for(user)
    payment_creator = payment_creator_for(operation)

    with_empty_subscription do
      Identity::EmailAuthentication.stub(:new, authentication) do
        Identity::EmailVerification.stub(:new, verification) do
          visit register_path
          fill_in "E-mail", with: user.email
          fill_in "Пароль", with: "transient-secret"
          fill_in "Повторите пароль", with: "transient-secret"
          click_button "Создать аккаунт"
        end
      end

      assert_current_path register_verify_email_path
      assert_text "Подтвердите e-mail"

      Identity::EmailVerification.stub(:new, verification) do
        fill_in "Код подтверждения", with: "123456"
        click_button "Подтвердить e-mail"
      end

      assert_current_path passkey_setup_path
      assert_text "Быстрый вход"
      click_button "Продолжить без него"
      assert_current_path cabinet_path
      assert_text "E-mail подтверждён."

      with_offers do
        visit tariffs_path
        click_link "Выбрать"
        assert_current_path purchase_page_path(
          plan_code: "basic",
          duration_days: 30,
          gateway_type: "CARD"
        )

        Payments::CreateOperation.stub(:new, payment_creator) do
          click_button "Перейти к оплате"
        end
      end

      assert_current_path payment_path(operation)
      assert_text "Состояние платежа"

      visit payment_success_path(operation_id: operation.id)
      assert_text "Проверяем оплату"
      click_link "В кабинет"
      assert_current_path cabinet_path

      click_button "Выйти"
      assert_current_path root_path
      assert_text "Вы вышли из аккаунта."
    end

    assert_predicate user.reload, :email_verified?
    assert user.web_sessions.reload.none?(&:active?)
  end

  private

  def authentication_for(user)
    result = stubbed_authentication_result(web_user: user)
    Object.new.tap do |operation|
      operation.define_singleton_method(:register!) { |_payload| result }
    end
  end

  def verification_for(user)
    Object.new.tap do |operation|
      operation.define_singleton_method(:request!) do |web_session:, email:|
        raise "wrong owner" unless web_session.web_user_id == user.id
        raise "wrong email" unless email == user.email

        { "target_email" => email }
      end
      operation.define_singleton_method(:confirm!) do |web_session:, code:|
        raise "wrong owner" unless web_session.web_user_id == user.id
        raise "wrong code" unless code == "123456"

        user.update!(email_verified: true)
        { "account_sync_pending" => false }
      end
    end
  end

  def payment_operation_for(user)
    user.payment_operations.create!(
      kind: :purchase,
      idempotency_key_hash: SecureRandom.hex(32),
      request_fingerprint: SecureRandom.hex(32),
      request_payload: { "plan_code" => "basic" },
      upstream_key: SecureRandom.uuid
    )
  end

  def payment_creator_for(operation)
    Object.new.tap do |creator|
      creator.define_singleton_method(:call!) do |kind:, web_session:, **|
        raise "wrong kind" unless kind == :purchase
        raise "wrong owner" unless web_session.web_user_id == operation.web_user_id

        Payments::CreateOperation::Result.new(
          operation:,
          payment: nil,
          replayed: false
        )
      end
    end
  end
end
