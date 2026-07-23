import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["status"]

  connect() {
    const telegram = window.Telegram?.WebApp
    if (!telegram?.initData) {
      this.statusTarget.textContent =
        "Откройте эту страницу внутри Telegram, чтобы продолжить."
      return
    }

    telegram.ready()
    this.submit(telegram.initData)
  }

  async submit(initData) {
    const token = document.querySelector("meta[name=csrf-token]")?.content || ""
    const body = new URLSearchParams({
      "telegram_session[init_data]": initData,
      "telegram_session[redirect_to]": "/cabinet",
      "authenticity_token": token
    })
    try {
      const response = await fetch("/account/telegram_session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body
      })
      if (!response.ok) throw new Error("telegram_failed")
      window.location.assign(response.url)
    } catch {
      this.statusTarget.textContent =
        "Не удалось подтвердить вход. Повторите попытку из Telegram."
    }
  }
}
