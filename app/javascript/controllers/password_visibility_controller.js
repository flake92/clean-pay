import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["input", "toggle", "confirmation"]

  toggle() {
    const visible = this.inputTarget.type === "text"
    this.inputTarget.type = visible ? "password" : "text"
    this.toggleTarget.textContent = visible ? "Показать пароль" : "Скрыть пароль"
    this.toggleTarget.setAttribute("aria-pressed", String(!visible))
    this.inputTarget.focus({ preventScroll: true })
  }

  validate() {
    if (!this.hasConfirmationTarget || !this.hasInputTarget) return

    const message = this.confirmationTarget.value === this.inputTarget.value ?
      "" : "Пароли должны совпадать."
    this.confirmationTarget.setCustomValidity(message)
  }
}
