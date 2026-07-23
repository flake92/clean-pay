module QualityPlanAudit
  module_function

  SOURCE_ROOTS = %w[app bin config db lib test scripts deploy].freeze
  POSITIVE_IMPLEMENTATION = /\A(?:ДА|Н\/П[: —])/
  POSITIVE_REVIEW = /\A(?:ДА|Н\/П[: —])/
  POSITIVE_RUNTIME = /\A(?:ДА:|Н\/П[: —])/

  def rows
    plan.each_line.filter_map do |line|
      cells = line.split("|").map(&:strip)
      next unless cells[1]&.match?(/\A[A-Z][A-Z0-9-]+\z/)
      next if cells[1] == "ID"

      cells
    end
  end

  def verify_structure!
    ids = rows.map { _1[1] }
    duplicates = ids.tally.select { _2 > 1 }.keys
    abort "Duplicate plan IDs: #{duplicates.join(", ")}" if duplicates.any?

    malformed = rows.filter_map do |cells|
      next if cells.size.in?([ 8, 9 ])
      "#{cells[1]} (#{cells.size - 2} cells)"
    end
    abort "Malformed plan rows: #{malformed.join(", ")}" if malformed.any?

    unregistered = source_files.reject { plan.include?("`#{_1}`") }
    abort "Unregistered source files: #{unregistered.join(", ")}" if unregistered.any?

    puts "quality:plan OK (#{ids.size} unique rows, #{source_files.size} source files registered)"
  end

  def verify_release!
    invalid = rows.filter_map do |cells|
      implementation, review, runtime = cells.last(4).first(3)
      next if implementation.match?(POSITIVE_IMPLEMENTATION) &&
        review.match?(POSITIVE_REVIEW) &&
        runtime.match?(POSITIVE_RUNTIME)

      "#{cells[1]}: #{implementation} / #{review} / #{runtime}"
    end
    abort "Non-final plan rows:\n#{invalid.join("\n")}" if invalid.any?

    puts "quality:release_plan OK (#{rows.size} rows have final evidence)"
  end

  def plan = @plan ||= Rails.root.join("TECHNICAL_IMPLEMENTATION_PLAN.md").read

  def source_files
    @source_files ||= SOURCE_ROOTS.flat_map do |root|
      Rails.root.glob("#{root}/**/*", File::FNM_DOTMATCH).filter_map do |path|
        next unless path.file?
        next if path.basename.to_s == ".DS_Store"

        path.relative_path_from(Rails.root).to_s
      end
    end.sort
  end
end

namespace :quality do
  desc "Verify unique ledger rows and complete source-file registration"
  task plan: :environment do
    QualityPlanAudit.verify_structure!
  end

  desc "Require a final positive status and evidence in every ledger row"
  task release_plan: :environment do
    QualityPlanAudit.verify_structure!
    QualityPlanAudit.verify_release!
  end

  desc "Verify that routes, schema, implementation plan and source tree agree"
  task structure: [ :environment, :plan ] do
    required_routes = %w[
      / /login /register /register/verify-email /verify-email
      /auth/telegram/webapp /passkey/setup /cabinet /tariffs /payment
      /extend /payment/success /payment/fail /payment/pending /profile
      /link-account /support /install /offline
    ]
    routes = Rails.application.routes.routes.map { _1.path.spec.to_s }
    missing_routes = required_routes.reject do |path|
      routes.any? { _1.sub("(.:format)", "") == path }
    end
    abort "Missing routes: #{missing_routes.join(", ")}" if missing_routes.any?

    expected_tables = %w[
      account_merge_confirmations app_settings audit_logs
      email_verification_codes integration_statuses payment_history_sync_states
      payment_operations payment_records rate_limit_events
      telegram_auth_states web_authn_challenges web_authn_credentials
      web_refresh_tokens web_sessions web_users
    ]
    missing_tables = expected_tables - ActiveRecord::Base.connection.tables
    abort "Missing tables: #{missing_tables.join(", ")}" if missing_tables.any?

    puts "quality:structure OK (19 pages, 15 tables)"
  end
end
