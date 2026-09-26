import type { SupportReader } from "@/application/support/ports/support-reader";
import type { SupportViewModel } from "@/application/models/support";

export function loadSupportViewModel(reader: SupportReader): SupportViewModel {
  return reader.load();
}

export function supportPageDescription(support: SupportViewModel) {
  const hasPublishedContacts = support.enabled && Boolean(
    support.email || support.telegramUsername || support.faqUrl,
  );

  if (support.liveChatEnabled && hasPublishedContacts) {
    return "После входа доступен чат; также можно выбрать удобный способ связи.";
  }
  if (support.liveChatEnabled) {
    return "Авторизованным пользователям доступен чат поддержки.";
  }
  if (hasPublishedContacts) {
    return "Выберите удобный способ связи.";
  }
  return "Инструкции по подключению, оплате и восстановлению доступа.";
}
