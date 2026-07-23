module Payments
  class IdempotencyKey
  include ActiveModel::Validations

  UUID_PATTERN =
    /\A[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/i

  attr_reader :value

  validates :value, format: { with: UUID_PATTERN }

  def self.parse(value)
    new(value).tap(&:validate!)
  end

  def initialize(value)
    @value = value.to_s.downcase
    freeze
  end

  def digest(secret:)
    OpenSSL::HMAC.hexdigest("SHA256", secret, value)
    end
  end
end
