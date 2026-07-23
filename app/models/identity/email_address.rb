module Identity
  class EmailAddress
  include ActiveModel::Validations

  attr_reader :value

  validates :value, presence: true, format: { with: URI::MailTo::EMAIL_REGEXP }

  def self.parse(value)
    new(value).tap(&:validate!)
  end

  def initialize(value)
    @value = value.to_s.strip.downcase
    freeze
  end

  def to_s = value
  def ==(other) = other.is_a?(self.class) && other.value == value
  alias eql? ==
    def hash = value.hash
  end
end
