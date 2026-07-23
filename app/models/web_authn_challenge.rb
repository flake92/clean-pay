class WebAuthnChallenge < ApplicationRecord
  class UnavailableError < StandardError; end

  belongs_to :web_user, optional: true

  enum :challenge_type,
    { registration: "REGISTRATION", authentication: "AUTHENTICATION" },
    validate: true

  validates :challenge, presence: true, uniqueness: true
  validates :expires_at, presence: true

  scope :available, -> {
    where(consumed_at: nil).where("expires_at > ?", Time.current)
  }

  def consume!(at: Time.current)
    with_lock do
      raise UnavailableError if consumed_at.present? || expires_at <= at

      update!(consumed_at: at)
    end
  end
end
