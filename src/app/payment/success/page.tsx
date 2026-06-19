export default function PaymentSuccessPage() {
  return (
    <main className="mx-auto grid min-h-screen w-full max-w-xl content-center px-6 py-16">
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-cyan-700">
        CleanVPN
      </p>
      <h1 className="mt-4 text-3xl font-semibold">Оплата принята</h1>
      <p className="mt-4 text-zinc-600">
        Мы обновим данные подписки через Remnashop. Проверьте статус в кабинете.
      </p>
      <a className="mt-8 inline-flex h-11 w-fit items-center bg-zinc-950 px-4 text-white" href="/cabinet">
        Открыть кабинет
      </a>
    </main>
  );
}
