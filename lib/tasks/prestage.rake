namespace :prestage do
  COMPOSE = %w[docker compose -f docker-compose.yml -f docker-compose.app.yml].freeze
  RESOLVED_COMPOSE = "tmp/prestage.compose.yml"

  desc "Validate and start prestage without deleting networks or volumes"
  task :up do
    require "socket"

    begin
      Socket.tcp("127.0.0.1", 4000, connect_timeout: 1).close
      abort "port 4000 is already occupied"
    rescue Errno::ECONNREFUSED, Errno::ETIMEDOUT
      # Expected precondition: no other application owns the prestage port.
    end

    sh(*COMPOSE, "config", "--quiet")
    FileUtils.mkdir_p("tmp")
    sh(*COMPOSE, "config", "--output", RESOLVED_COMPOSE)
    sh(*COMPOSE, "up", "-d", "--build", "postgres", "redis", "app", "retention")
    project = ENV.fetch("COMPOSE_PROJECT_NAME", "clean-pay-dev")
    sh(
      "scripts/wait-for-compose.sh",
      project,
      RESOLVED_COMPOSE,
      "180",
      "app",
      "retention"
    )
  end

  desc "Run black-box readiness and Rails acceptance checks against prestage"
  task :verify do
    sh("scripts/wait-for-http.sh", "http://127.0.0.1:4000/health/liveness", "180")
    sh(*COMPOSE, "exec", "-T", "app", "bin/rails", "quality:structure")
  end

  desc "Stop only application processes; preserve shared dependencies and volumes"
  task :down do
    sh(*COMPOSE, "stop", "app", "retention", "reconciliation")
    sh(*COMPOSE, "rm", "-f", "app", "retention", "reconciliation")
    FileUtils.rm_f(RESOLVED_COMPOSE)
  end
end
