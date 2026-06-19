export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-6 py-16">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-cyan-700">
          CleanVPN
        </p>
        <h1 className="mt-5 max-w-3xl text-4xl font-semibold leading-tight sm:text-6xl">
          Web-кабинет для оплаты и управления подпиской
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-600">
          Базовый каркас приложения готовится как отдельный Next.js BFF:
          frontend работает только с нашим серверным слоем, а бизнес-операции
          будут выполняться через Remnashop API.
        </p>
        <div className="mt-10 grid gap-3 text-sm text-zinc-700 sm:grid-cols-3">
          <div className="border border-zinc-200 bg-white p-4">
            Next.js App Router
          </div>
          <div className="border border-zinc-200 bg-white p-4">
            Prisma + PostgreSQL
          </div>
          <div className="border border-zinc-200 bg-white p-4">
            BFF без доступа к БД Remnashop
          </div>
        </div>
        <div className="mt-8 flex flex-wrap gap-3">
          <a className="bg-zinc-950 px-4 py-2 text-white" href="/login">
            Войти
          </a>
          <a className="border border-zinc-300 px-4 py-2" href="/register">
            Регистрация
          </a>
          <a className="border border-zinc-300 px-4 py-2" href="/cabinet">
            Кабинет
          </a>
          <a className="border border-zinc-300 px-4 py-2" href="/verify-email">
            E-mail
          </a>
        </div>
      </section>
    </main>
  );
}
