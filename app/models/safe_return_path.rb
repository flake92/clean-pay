class SafeReturnPath
  include ActiveModel::Validations

  attr_reader :value

  validate :must_be_local

  def self.parse(value, default: "/")
    candidate = new(value.presence || default)
    candidate.validate!
    candidate
  end

  def initialize(value)
    @value = value.to_s
    freeze
  end

  def to_s = value

  private

  def must_be_local
    return if value.start_with?("/") &&
      !value.start_with?("//") &&
      !value.match?(/[\\\0]/)

    errors.add(:value, :invalid)
  end
end
