class PaymentRecord < ApplicationRecord
  belongs_to :web_user
  belongs_to :payment_operation, optional: true

  enum :purchase_type, {
    new_purchase: "NEW",
    renew: "RENEW",
    change: "CHANGE"
  }, validate: true
  enum :status, {
    pending: "PENDING",
    completed: "COMPLETED",
    failed: "FAILED",
    canceled: "CANCELED",
    refunded: "REFUNDED",
    unknown: "UNKNOWN"
  }, validate: true

  validates :payment_id, :currency, :gateway_type, :final_amount, presence: true
  validates :payment_id, uniqueness: true
  validates :payment_operation_id, uniqueness: true, allow_nil: true
  validates :final_amount,
    numericality: { greater_than_or_equal_to: 0, less_than: 10_000_000_000 }

  scope :recent_first, -> {
    order(upstream_created_at: :desc, payment_id: :desc)
  }

  def self.upsert_upstream!(web_user:, attributes:, payment_operation: nil)
    values = attributes.to_h.stringify_keys
    payment_id = values.fetch("payment_id").to_s
    Payments::IdempotencyKey.parse(payment_id)
    validate_gateway!(values.fetch("gateway_type"))
    validate_currency!(values.fetch("currency"))
    record = find_or_initialize_by(payment_id:)
    raise ActiveRecord::RecordNotUnique if
      record.persisted? && record.web_user_id != web_user.id

    incoming_updated_at = parse_time(values["updated_at"])
    return record if record.persisted? &&
      record.upstream_updated_at &&
      incoming_updated_at &&
      incoming_updated_at < record.upstream_updated_at

    record.assign_attributes(
      web_user:,
      payment_operation: payment_operation || record.payment_operation,
      purchase_type: normalize_purchase_type(values.fetch("purchase_type")),
      status: normalize_status(values.fetch("status")),
      final_amount:
        Payments::MoneyAmount.parse(values.fetch("final_amount")).to_d,
      currency: values.fetch("currency"),
      gateway_type: values.fetch("gateway_type"),
      payment_url: safe_payment_url(values["payment_url"]),
      plan_id: values["plan_id"] || values["plan_code"],
      plan_name: values["plan_name"],
      duration_days: values["duration_days"],
      device_limit: values["device_limit"],
      traffic_limit_bytes:
        values["traffic_limit_bytes"] || values["traffic_limit"],
      is_free: values["is_free"] == true,
      upstream_created_at: parse_time(values["created_at"]),
      upstream_updated_at: incoming_updated_at,
      raw: values.except("payment_url")
    )
    record.save!
    record
  end

  def self.validate_transaction!(attributes)
    values = attributes.to_h.stringify_keys
    Payments::IdempotencyKey.parse(values.fetch("payment_id"))
    normalize_purchase_type(values.fetch("purchase_type"))
    raise KeyError unless statuses.value?(values.fetch("status").to_s.upcase)

    validate_gateway!(values.fetch("gateway_type"))
    validate_currency!(values.fetch("currency"))
    Payments::MoneyAmount.parse(values.fetch("final_amount"))
    %w[duration_days device_limit traffic_limit traffic_limit_bytes].each do |key|
      next if values[key].nil?

      integer = Integer(values[key], exception: false)
      raise ArgumentError unless integer&.>= 0

      values[key] = integer
    end
    created_at = Time.iso8601(values.fetch("created_at"))
    updated_at = Time.iso8601(values.fetch("updated_at"))
    raise ArgumentError if updated_at < created_at

    values
  end

  def self.normalize_purchase_type(value)
    {
      "NEW" => :new_purchase,
      "RENEW" => :renew,
      "CHANGE" => :change
    }.fetch(value.to_s.upcase)
  end

  def self.normalize_status(value)
    value = value.to_s.upcase
    return :unknown unless statuses.value?(value)

    statuses.key(value)
  end

  def self.safe_payment_url(value)
    return if value.blank?

    uri = URI.parse(value)
    raise URI::InvalidURIError unless uri.is_a?(URI::HTTP) && uri.host

    uri.to_s
  end

  def self.parse_time(value)
    Time.iso8601(value) if value.present?
  end

  def self.validate_gateway!(value)
    raise ArgumentError unless
      value.to_s.match?(/\A[A-Z][A-Z0-9_-]{0,63}\z/)
  end

  def self.validate_currency!(value)
    text = value.to_s
    raise ArgumentError unless text.length.between?(1, 16) &&
      text.match?(/\A[[:print:]]+\z/) &&
      !text.match?(/[[:cntrl:]]/)
  end
end
