require "application_system_test_case"
require "base64"
require "chunky_png"
require "fileutils"

class VisualComparisonTest < ApplicationSystemTestCase
  LOCAL_CHROME = Dir.glob(
    File.join(
      Dir.home,
      ".cache/selenium/chrome/*/*/Google Chrome for Testing.app/" \
        "Contents/MacOS/Google Chrome for Testing"
    )
  ).max

  Capybara.register_driver :visual_chrome do |app|
    options = Selenium::WebDriver::Chrome::Options.new
    options.add_argument("--headless=new")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox") if ENV["CI"]
    options.binary = ENV["CHROME_BIN"].presence || LOCAL_CHROME if
      ENV["CHROME_BIN"].present? || LOCAL_CHROME
    Capybara::Selenium::Driver.new(app, browser: :chrome, options:)
  end

  driven_by :visual_chrome

  VIEWPORTS = {
    desktop: [ 1440, 1000 ],
    mobile: [ 390, 844 ]
  }.freeze
  MINIMUM_SIMILARITY = 0.88
  SAMPLE_STEP = 2
  OUTPUT_ROOT = Rails.root.join("tmp/visual")

  Scene = Data.define(:id, :path, :session, :catalog) do
    def initialize(id:, path:, session:, catalog: nil)
      super
    end
  end

  SCENES = [
    Scene.new(id: "PAGE-001-root", path: "/", session: :guest),
    Scene.new(id: "PAGE-002-login", path: "/login", session: :guest),
    Scene.new(id: "PAGE-003-register", path: "/register", session: :guest),
    Scene.new(
      id: "PAGE-004-register-verify-email",
      path: "/register/verify-email",
      session: :bootstrap_unverified
    ),
    Scene.new(
      id: "PAGE-005-verify-email",
      path: "/verify-email",
      session: :full_unverified
    ),
    Scene.new(
      id: "PAGE-006-telegram-webapp",
      path: "/auth/telegram/webapp",
      session: :guest
    ),
    Scene.new(
      id: "PAGE-007-passkey-setup",
      path: "/passkey/setup",
      session: :bootstrap_verified
    ),
    Scene.new(id: "PAGE-008-cabinet", path: "/cabinet", session: :full),
    Scene.new(
      id: "PAGE-009-tariffs",
      path: "/tariffs",
      session: :full,
      catalog: :offers
    ),
    Scene.new(
      id: "PAGE-010-payment",
      path: "/payment?plan_code=missing",
      session: :full,
      catalog: :offers
    ),
    Scene.new(
      id: "PAGE-011-extend",
      path: "/extend",
      session: :full,
      catalog: :empty
    ),
    Scene.new(
      id: "PAGE-012-payment-success",
      path: "/payment/success",
      session: :full
    ),
    Scene.new(
      id: "PAGE-013-payment-fail",
      path: "/payment/fail",
      session: :full
    ),
    Scene.new(
      id: "PAGE-014-payment-pending",
      path: "/payment/pending",
      session: :full
    ),
    Scene.new(id: "PAGE-015-profile", path: "/profile", session: :full),
    Scene.new(
      id: "PAGE-016-link-account",
      path: "/link-account",
      session: :full
    ),
    Scene.new(id: "PAGE-017-support", path: "/support", session: :full),
    Scene.new(id: "PAGE-018-install", path: "/install", session: :guest),
    Scene.new(id: "PAGE-019-offline", path: "/offline", session: :guest)
  ].freeze

  test "matches every authoritative desktop and mobile reference" do
    FileUtils.rm_rf(OUTPUT_ROOT)
    FileUtils.mkdir_p(OUTPUT_ROOT)
    catalog = MutableCatalog.new
    access = empty_access
    results = []

    Subscriptions::Catalog.stub(:new, -> { catalog }) do
      Subscriptions::CurrentAccess.stub(:new, -> { access }) do
        VIEWPORTS.each do |viewport, size|
          resize_to(*size)
          SCENES.each do |scene|
            catalog.mode = scene.catalog || :empty
            prepare_session(scene.session)
            results << compare_scene(scene, viewport, size)
          end
        end
      end
    end

    write_report(results)
    failures = results.reject { _1.fetch(:passed) }
    assert_empty failures, failure_message(failures)
  end

  class MutableCatalog
    attr_accessor :mode

    def public_plans = payload
    def offers(**) = payload

    private

    def payload
      mode == :offers ? ApplicationSystemTestCase::OFFERS : { "plans" => [] }
    end
  end

  private

  def empty_access
    Object.new.tap do |operation|
      operation.define_singleton_method(:call) { |**| nil }
    end
  end

  def prepare_session(kind)
    visit root_path unless page.current_url.start_with?("http")
    page.driver.browser.manage.delete_all_cookies
    return if kind == :guest

    attributes = {
      email_verified: !kind.to_s.end_with?("unverified"),
      auth_pending: kind.to_s.start_with?("bootstrap")
    }
    user = create_web_user(**attributes)
    sign_in_browser(
      web_user: user,
      assurance_level:
        kind.to_s.start_with?("bootstrap") ? :bootstrap : :full,
      upstream: kind == :full
    )
  end

  def compare_scene(scene, viewport, size)
    visit scene.path
    assert_equal scene.path.split("?").first, URI(page.current_url).path
    assert_equal 0, horizontal_overflow

    actual_path = output_path("actual", viewport, scene.id)
    reference_path = reference_path(viewport, scene.id)
    decoded_path = output_path("reference", viewport, scene.id)
    diff_path = output_path("diff", viewport, scene.id)
    save_viewport(actual_path)
    render_reference(reference_path, decoded_path, size)
    metric = compare_png(actual_path, decoded_path, diff_path)

    {
      scene: scene.id,
      viewport:,
      similarity: metric.fetch(:similarity),
      passed: metric.fetch(:similarity) >= MINIMUM_SIMILARITY,
      dimensions: metric.fetch(:dimensions)
    }
  end

  def resize_to(width, height)
    page.driver.browser.execute_cdp(
      "Emulation.setDeviceMetricsOverride",
      width:,
      height:,
      deviceScaleFactor: 1,
      mobile: false
    )
  end

  def horizontal_overflow
    page.evaluate_script(
      "Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) " \
      "- document.documentElement.clientWidth"
    )
  end

  def save_viewport(path)
    FileUtils.mkdir_p(path.dirname)
    page.driver.browser.save_screenshot(path.to_s)
  end

  def render_reference(source, target, size)
    image = Base64.strict_encode64(source.binread)
    html = <<~HTML
      <!doctype html><style>
      html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#fff}
      img{display:block;width:100%;height:100%;object-fit:fill}
      </style><img src="data:image/jpeg;base64,#{image}">
    HTML
    resize_to(*size)
    visit "data:text/html;base64,#{Base64.strict_encode64(html)}"
    save_viewport(target)
  end

  def compare_png(actual_path, reference_path, diff_path)
    actual = ChunkyPNG::Image.from_file(actual_path)
    reference = ChunkyPNG::Image.from_file(reference_path)
    dimensions = "#{actual.width}x#{actual.height}"
    expected_dimensions = "#{reference.width}x#{reference.height}"
    return {
      similarity: 0.0,
      dimensions: "#{dimensions} vs #{expected_dimensions}"
    } unless actual.dimension == reference.dimension

    total = 0
    samples = 0
    diff_width = (actual.width.fdiv(SAMPLE_STEP)).ceil
    diff_height = (actual.height.fdiv(SAMPLE_STEP)).ceil
    diff = ChunkyPNG::Image.new(diff_width, diff_height, :white)
    (0...actual.height).step(SAMPLE_STEP) do |y|
      (0...actual.width).step(SAMPLE_STEP) do |x|
        first = actual[x, y]
        second = reference[x, y]
        channels = %i[r g b].map do |channel|
          ChunkyPNG::Color.public_send(channel, first) -
            ChunkyPNG::Color.public_send(channel, second)
        end.map(&:abs)
        total += channels.sum
        samples += 1
        color = ChunkyPNG::Color.rgb(*channels)
        diff[x / SAMPLE_STEP, y / SAMPLE_STEP] = color
      end
    end
    FileUtils.mkdir_p(diff_path.dirname)
    diff.save(diff_path)
    maximum = samples * 3 * 255
    {
      similarity: 1.0 - (total.fdiv(maximum)),
      dimensions:
    }
  end

  def reference_path(viewport, id)
    Rails.root.join(
      "software-spec/05-frontend/reference/current",
      viewport.to_s,
      "#{id}.jpg"
    )
  end

  def output_path(kind, viewport, id)
    OUTPUT_ROOT.join(kind.to_s, viewport.to_s, "#{id}.png")
  end

  def write_report(results)
    rows = results.map do |result|
      status = result.fetch(:passed) ? "PASS" : "FAIL"
      "| #{result.fetch(:scene)} | #{result.fetch(:viewport)} | " \
        "#{format('%.2f%%', result.fetch(:similarity) * 100)} | " \
        "#{result.fetch(:dimensions)} | #{status} |"
    end
    report = <<~MARKDOWN
      # Visual comparison

      Minimum similarity: #{format("%.2f%%", MINIMUM_SIMILARITY * 100)}
      Sample step: #{SAMPLE_STEP}px

      | Scene | Viewport | Similarity | Dimensions | Status |
      |---|---|---:|---|---|
      #{rows.join("\n")}
    MARKDOWN
    OUTPUT_ROOT.join("report.md").write(report)
  end

  def failure_message(failures)
    lines = failures.map do |failure|
      "#{failure.fetch(:scene)}/#{failure.fetch(:viewport)}=" \
        "#{format('%.2f%%', failure.fetch(:similarity) * 100)}"
    end
    "Visual differences exceed threshold: #{lines.join(', ')}; " \
      "see #{OUTPUT_ROOT.join('report.md')}"
  end
end
