class ConfirmedOffer
  include ActiveModel::Validations

  CURRENCY_PATTERN = /\A[A-Z0-9]{2,12}\z/

  attr_reader :amount, :currency, :version, :duration_days, :plan_id

  validates :amount, :currency, :version, :duration_days, :plan_id, presence: true
  validates :amount,
    format: { with: /\A(?:0|[1-9]\d*)(?:\.\d{1,8})?\z/ }
  validates :currency, format: { with: CURRENCY_PATTERN }
  validates :version, length: { maximum: 2048 }
  validates :duration_days,
    numericality: { only_integer: true, greater_than: 0 }

  def self.from(params)
    new(**params.symbolize_keys.slice(
      :amount,
      :currency,
      :version,
      :duration_days,
      :plan_id
    )).tap(&:validate!)
  end

  def initialize(amount:, currency:, version:, duration_days:, plan_id:)
    @amount = amount.to_s
    @currency = currency.to_s
    @version = version.to_s
    @duration_days = Integer(duration_days, exception: false)
    @plan_id = plan_id.to_s
    freeze
  end

  def fingerprint
    Digest::SHA256.hexdigest(
      [ plan_id, amount, currency, version, duration_days ].to_json
    )
  end
end
