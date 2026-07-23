module Payments
  class MoneyAmount
  include ActiveModel::Validations

  MAXIMUM = BigDecimal("9999999999.99")
  SCALE = 2

  attr_reader :value

  validates :value,
    numericality: {
      greater_than_or_equal_to: 0,
      less_than_or_equal_to: MAXIMUM
    }
  validate :must_fit_scale

  def self.parse(value)
    new(value).tap(&:validate!)
  end

  def initialize(value)
    @value = BigDecimal(value.to_s, exception: false)
    freeze
  end

  def to_d = value
  def to_s = value.to_s("F")

  private

  def must_fit_scale
    return if value.nil?
    return if value == value.round(SCALE)

    errors.add(:value, :invalid)
    end
  end
end
