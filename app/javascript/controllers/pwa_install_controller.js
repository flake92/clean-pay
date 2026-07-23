import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["button", "status", "dialog"]

  connect() {
    this.capture = event => {
      event.preventDefault()
      this.prompt = event
      this.buttonTarget.hidden = false
      this.statusTarget.textContent = "Приложение готово к установке."
    }
    addEventListener("beforeinstallprompt", this.capture)

    if (matchMedia("(display-mode: standalone)").matches) {
      this.buttonTarget.hidden = true
      this.statusTarget.textContent = "Clean Pay уже установлен."
    } else if (/iphone|ipad/i.test(navigator.userAgent)) {
      this.statusTarget.textContent =
        "В Safari нажмите «Поделиться», затем «На экран Домой»."
      this.dialogTarget.showModal()
    }
  }

  disconnect() {
    removeEventListener("beforeinstallprompt", this.capture)
  }

  async install() {
    if (!this.prompt) {
      this.statusTarget.textContent =
        "Используйте меню браузера «Установить приложение»."
      this.dialogTarget.showModal()
      return
    }

    this.prompt.prompt()
    const choice = await this.prompt.userChoice
    this.statusTarget.textContent = choice.outcome === "accepted" ?
      "Установка началась." : "Установка отменена."
    this.prompt = null
  }
}
