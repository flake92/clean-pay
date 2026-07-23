Rails.application.config.after_initialize do
  next unless Rails.application.config.eager_load

  raise "ApplicationPolicy must deny access by default" unless
    ApplicationPolicy.new(nil, nil).denied_by_default?
end
