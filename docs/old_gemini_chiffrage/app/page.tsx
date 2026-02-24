import TakeoffModule from '@/components/TakeoffModule';

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="flex items-center justify-between pb-6 border-b border-slate-200">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Module de Chiffrage & Takeoff</h1>
            <p className="text-slate-500 text-sm mt-1">Extraction et normalisation des quantités assistées par IA</p>
          </div>
        </header>
        <TakeoffModule />
      </div>
    </main>
  );
}
