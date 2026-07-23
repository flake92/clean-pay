class PlatformPolicy < ApplicationPolicy
  def public? = true

  def internal?
    expected = Rails.application.config.x.clean_pay.readiness.internal_secret
    return false unless expected

    ActiveSupport::SecurityUtils.secure_compare(record.to_s, expected.value)
  end
end
