import { LoginForm } from "@/components/auth-forms";

export default function LoginPage() {
  return (
    <main className="mx-auto grid min-h-screen w-full max-w-md content-center px-6 py-16">
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-cyan-700">
        CleanVPN
      </p>
      <h1 className="mt-4 text-3xl font-semibold">Вход</h1>
      <div className="mt-8">
        <LoginForm />
      </div>
      <a className="mt-5 text-sm text-cyan-700" href="/register">
        Создать аккаунт
      </a>
      <a
        className="mt-3 inline-flex h-11 items-center justify-center bg-cyan-700 px-4 text-white"
        href="/auth/telegram/start?redirect_to=/cabinet"
      >
        Войти через Telegram
      </a>
    </main>
  );
}
