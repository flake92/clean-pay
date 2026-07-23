class ApplicationRecord < ActiveRecord::Base
  primary_abstract_class

  before_validation :assign_string_id, on: :create

  private

  # The preserved schema intentionally uses opaque string identifiers. Keep
  # their generation in one infrastructure callback instead of repeating it in
  # every model; natural-key models such as AppSetting are left untouched.
  def assign_string_id
    self.id ||= SecureRandom.uuid if self.class.primary_key == "id"
  end
end
