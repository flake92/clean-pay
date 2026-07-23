import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["name", "status"]

  async register() {
    if (!window.PublicKeyCredential) {
      this.report("Этот браузер не поддерживает Passkey.")
      return
    }

    try {
      this.report("Запрашиваем параметры…")
      const options = await this.request("/account/passkey_registration", "POST")
      const credential = await navigator.credentials.create({
        publicKey: this.decodeOptions(options)
      })
      const payload = this.serializeCredential(credential)
      if (this.hasNameTarget) payload.name = this.nameTarget.value
      await this.request("/account/passkey_registration", "PATCH", payload)
      this.report("Passkey добавлен.")
      window.location.assign("/cabinet")
    } catch (error) {
      this.report(error.name === "NotAllowedError" ?
        "Настройка отменена. Можно продолжить без Passkey." :
        "Не удалось добавить Passkey. Попробуйте ещё раз.")
    }
  }

  async authenticate() {
    if (!window.PublicKeyCredential) {
      this.report("Этот браузер не поддерживает Passkey.")
      return
    }

    try {
      this.report("Подтвердите вход на устройстве…")
      const options = await this.request("/account/passkey_session", "POST")
      const credential = await navigator.credentials.get({
        publicKey: this.decodeOptions(options)
      })
      await this.request(
        "/account/passkey_session",
        "PATCH",
        this.serializeCredential(credential)
      )
      window.location.assign("/cabinet")
    } catch (error) {
      this.report(error.name === "NotAllowedError" ?
        "Вход отменён." : "Не удалось войти с Passkey.")
    }
  }

  async request(url, method, body) {
    const response = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": document.querySelector("meta[name=csrf-token]")?.content || ""
      },
      body: body ? JSON.stringify(body) : "{}"
    })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error?.code || "request_failed")
    return payload.data
  }

  decodeOptions(options) {
    const decoded = { ...options, challenge: this.decode(options.challenge) }
    if (decoded.user?.id) {
      decoded.user = { ...decoded.user, id: this.decode(decoded.user.id) }
    }
    if (decoded.excludeCredentials) {
      decoded.excludeCredentials = decoded.excludeCredentials.map(item => ({
        ...item, id: this.decode(item.id)
      }))
    }
    if (decoded.allowCredentials) {
      decoded.allowCredentials = decoded.allowCredentials.map(item => ({
        ...item, id: this.decode(item.id)
      }))
    }
    return decoded
  }

  serializeCredential(credential) {
    const response = credential.response
    const value = {
      id: credential.id,
      rawId: this.encode(credential.rawId),
      type: credential.type,
      response: {
        clientDataJSON: this.encode(response.clientDataJSON)
      }
    }
    if (response.attestationObject) {
      value.response.attestationObject = this.encode(response.attestationObject)
      value.response.transports = response.getTransports?.() || []
    } else {
      value.response.authenticatorData = this.encode(response.authenticatorData)
      value.response.signature = this.encode(response.signature)
      value.response.userHandle = response.userHandle ?
        this.encode(response.userHandle) : null
    }
    return value
  }

  decode(value) {
    const input = value.replaceAll("-", "+").replaceAll("_", "/")
    const binary = atob(input.padEnd(Math.ceil(input.length / 4) * 4, "="))
    return Uint8Array.from(binary, character => character.charCodeAt(0))
  }

  encode(buffer) {
    const binary = String.fromCharCode(...new Uint8Array(buffer))
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
  }

  report(message) {
    if (this.hasStatusTarget) this.statusTarget.textContent = message
  }
}
