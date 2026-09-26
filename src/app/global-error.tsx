"use client";

import Link from "next/link";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  const incidentId = error.digest?.trim() || null;

  return (
    <html lang="ru">
      <body>
        <main role="alert">
          <h1>Сервис временно недоступен</h1>
          <p>Попробуйте загрузить страницу ещё раз.</p>
          {incidentId ? <p>Код события: {incidentId}</p> : null}
          <button onClick={reset} type="button">Попробовать снова</button>
          <p><Link href="/">На главную</Link></p>
        </main>
      </body>
    </html>
  );
}
