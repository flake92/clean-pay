import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static values = { siteKey: String }

  connect() {
    this.renderAttempts = 0
    this.renderWhenReady()
  }

  disconnect() {
    clearTimeout(this.renderTimer)
    if (this.widgetId !== undefined && window.turnstile?.remove) {
      window.turnstile.remove(this.widgetId)
    }
  }

  renderWhenReady = () => {
    if (!this.element.isConnected) return

    if (!window.turnstile?.render) {
      this.renderAttempts += 1
      if (this.renderAttempts < 100) {
        this.renderTimer = setTimeout(this.renderWhenReady, 100)
      }
      return
    }

    this.widgetId = window.turnstile.render(this.element, {
      sitekey: this.siteKeyValue
    })
  }
}
