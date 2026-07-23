Rails.application.routes.draw do
  namespace :account do
    resource :identity, only: :create
    resource :session, only: %i[create show update destroy]
    resource :registration, only: :create
    resource :password, only: :update
    resource :email_verification, only: %i[create update]
    resource :email, only: :update
    resource :passkey_registration,
      only: %i[create update],
      controller: "passkeys/registrations",
      defaults: { format: :json }
    resource :passkey_session,
      only: %i[create update],
      controller: "passkeys/sessions",
      defaults: { format: :json }
    resources :passkeys,
      only: %i[index destroy],
      controller: "passkeys/credentials"
    resource :telegram_session, only: :create, controller: "telegram/sessions"
    resource :merge_confirmation, only: %i[show update destroy]
    resource :remnashop_link, only: :create
    resource :telegram_authorization, only: :new do
      get :callback
      post :callback
    end
  end

  resources :plans, only: :index
  resource :subscription, only: :show do
    get :offers
    post :reissue
    post :promocode
    resources :devices, only: %i[index destroy] do
      delete "", on: :collection, action: :destroy
    end
  end
  resources :purchases, only: :create
  resources :extensions, only: :create
  resources :payments, only: %i[index show]
  resource :support, only: :show
  resource :health, only: :show do
    get :liveness
    get :readiness
  end
  namespace :internal do
    get "health/readiness", to: "readiness#show"
    resources :payment_reconciliations, only: :create
  end
  get "service-worker.js",
    to: "pwa#service_worker",
    defaults: { format: :js }
  get "manifest.webmanifest",
    to: "pwa#manifest",
    as: :web_app_manifest,
    defaults: { format: :webmanifest }

  root "pages#home"
  get "login", to: "identity/pages#login"
  get "register", to: "identity/pages#register"
  get "register/verify-email", to: "identity/pages#register_verify_email"
  get "verify-email", to: "identity/pages#verify_email"
  get "auth/telegram/webapp", to: "identity/pages#telegram_webapp"
  get "passkey/setup", to: "identity/pages#passkey_setup"
  get "cabinet", to: "subscriptions/pages#cabinet"
  get "tariffs", to: "subscriptions/pages#tariffs"
  get "payment", to: "payments/pages#payment", as: :purchase_page
  get "extend", to: "subscriptions/pages#extend"
  get "payment/success", to: "payments/pages#payment_success"
  get "payment/fail", to: "payments/pages#payment_fail"
  get "payment/pending", to: "payments/pages#payment_pending"
  get "profile", to: "identity/pages#profile"
  get "link-account", to: "identity/pages#link_account"
  get "install", to: "platform/pages#install"
  get "offline", to: "platform/pages#offline"
end
