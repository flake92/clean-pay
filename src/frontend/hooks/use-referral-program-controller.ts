"use client";

import { useState } from "react";

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Copy failed");
}

export function useReferralProgramController({
  referralUrl,
}: {
  referralUrl: string | null;
}) {
  const [feedback, setFeedback] = useState<string | null>(null);

  async function copyLink() {
    if (!referralUrl) return;

    try {
      await copyText(referralUrl);
      setFeedback("Ссылка скопирована.");
    } catch {
      setFeedback("Не удалось скопировать ссылку. Выделите её вручную.");
    }
  }

  async function shareLink() {
    if (!referralUrl) return;

    try {
      if (navigator.share) {
        await navigator.share({
          title: "Приглашение",
          text: "Присоединяйтесь по моей ссылке",
          url: referralUrl,
        });
        setFeedback("Ссылка отправлена.");
        return;
      }
      await copyText(referralUrl);
      setFeedback("Функция отправки недоступна — ссылка скопирована.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFeedback("Не удалось отправить ссылку.");
    }
  }

  return { copyLink, feedback, shareLink };
}
