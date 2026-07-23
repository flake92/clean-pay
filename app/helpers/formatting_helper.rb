module FormattingHelper
  def format_money(amount, currency)
    number_to_currency(
      amount,
      unit: currency,
      format: "%n %u",
      separator: ",",
      delimiter: " "
    )
  end

  def format_date(value)
    l(value, format: :short) if value
  end

  def format_duration(days)
    "#{days} дн."
  end

  def format_bytes(value)
    number_to_human_size(value || 0, locale: :ru)
  end

  def format_status(value)
    I18n.t(
      "statuses.#{value.to_s.downcase}",
      default: value.to_s.presence || "Неизвестно"
    )
  end
end
