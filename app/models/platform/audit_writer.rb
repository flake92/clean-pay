module Platform
  class AuditWriter
    def call(action:, web_user: Current.web_user, severity: :info, metadata: nil)
      AuditLog.create!(
        web_user:,
        action:,
        severity:,
        ip_hash: Current.ip_hash,
        metadata: filter(metadata)
      )
    end

    private

    def filter(metadata)
      return if metadata.blank?

      ActiveSupport::ParameterFilter.new(
        Rails.application.config.filter_parameters
      ).filter(metadata)
    end
  end
end
