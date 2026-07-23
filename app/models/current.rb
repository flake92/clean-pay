class Current < ActiveSupport::CurrentAttributes
  attribute :web_user, :web_session, :request_id, :ip_hash, :user_agent

  resets { Time.zone = nil }

  def web_user=(value)
    super
    self.web_session = nil if web_session&.web_user_id != value&.id
  end
end
