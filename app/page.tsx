// app/page.tsx
export default function HomePage() {
  return (
    <section className="space-y-6">
      <h1 className="text-3xl font-bold">
        Система анализа транзакций в блокчейне с присвоением{' '}
        <span className="text-emerald-400">risk score</span>
      </h1>

      <p className="text-slate-300 max-w-2xl">
        Введите адрес криптовалютного кошелька, выберите блокчейн и глубину анализа.
        Система соберёт транзакции, построит граф связей, подсветит подозрительные
        адреса и присвоит итоговый уровень риска.
      </p>

      <ul className="list-disc list-inside text-slate-300 space-y-1">
        <li>Поддержка нескольких блокчейнов (Bitcoin, Ethereum и др.).</li>
        <li>Подсветка кошельков из санкционных и подозрительных списков.</li>
        <li>Сохранение результатов анализа в личном кабинете.</li>
      </ul>
    </section>
  );
}
