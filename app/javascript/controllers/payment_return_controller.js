import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static values = {
    statusUrl: String,
    attempts: { type: Number, default: 5 }
  }
  static targets = ["status"]

  connect() {
    if (this.hasStatusUrlValue) this.poll(0)
  }

  disconnect() {
    clearTimeout(this.timer)
  }

  async poll(attempt) {
    if (attempt >= this.attemptsValue) {
      this.report("Проверка продолжается. Обновите страницу позже.")
      return
    }

    try {
      const response = await fetch(this.statusUrlValue, {
        headers: { "Accept": "text/html" },
        credentials: "same-origin",
        cache: "no-store"
      })
      if (!response.ok) throw new Error("status_failed")
      if (response.redirected) {
        window.location.assign(response.url)
        return
      }

      const html = await response.text()
      const document = new DOMParser().parseFromString(html, "text/html")
      const status = document.querySelector("[data-payment-status]")?.dataset.paymentStatus
      if (["SUCCEEDED", "FAILED_FINAL", "MANUAL_REQUIRED"].includes(status)) {
        window.location.assign(this.statusUrlValue)
      } else {
        this.report("Проверяем авторитетное состояние платежа…")
        this.timer = setTimeout(() => this.poll(attempt + 1), 2000)
      }
    } catch {
      this.timer = setTimeout(() => this.poll(attempt + 1), 2000)
    }
  }

  report(value) {
    if (this.hasStatusTarget) this.statusTarget.textContent = value
  }
}
