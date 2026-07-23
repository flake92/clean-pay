namespace :visual do
  desc "Render and compare all 19 desktop/mobile visual contracts"
  task :compare do
    success = system(
      { "RAILS_ENV" => "test" },
      "bin/rails",
      "test",
      "test/visual/visual_comparison_test.rb"
    )
    abort "Visual comparison failed" unless success
  end
end
