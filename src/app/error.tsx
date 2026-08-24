"use client";

import Link from "next/link";

type AppErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function AppError({ error, reset }: AppErrorProps) {
  const incidentId = error.digest?.trim() || null;

  return (
    <main className="min-h-screen flex align-items-center justify-content-center p-4" role="alert">
      <section className="card w-full max-w-30rem text-center">
        <i aria-hidden="true" className="pi pi-exclamation-triangle text-4xl text-orange-500" />
        <h1 className="mt-3 text-2xl font-semibold">Не удалось открыть страницу</h1>
        <p className="line-height-3 text-600">
          Попробуйте ещё раз. Если ошибка повторится, вернитесь в кабинет или
          передайте поддержке код события.
        </p>
        {incidentId ? (
          <p className="text-sm text-500 break-all">
            Код события: <code>{incidentId}</code>
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap justify-content-center gap-2">
          <button className="p-button p-component" onClick={reset} type="button">
            <span className="p-button-icon p-c pi pi-refresh" />
            <span className="p-button-label p-c">Попробовать снова</span>
          </button>
          <Link className="p-button p-component p-button-outlined" href="/cabinet">
            <span className="p-button-label p-c">Открыть кабинет</span>
          </Link>
        </div>
      </section>
    </main>
  );
}
