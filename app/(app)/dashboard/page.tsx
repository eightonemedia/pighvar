export default function DashboardPage() {
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-[#1A1A18]">Dashboard</h1>
      <p className="text-sm text-[#8A8A82] mt-1">
        Torsdag 14. maj 2026 · 20:34
      </p>

      <div className="mt-6 bg-white border border-[#E0DDD6] rounded-xl p-6">
        <h2 className="text-base font-medium text-[#1A1A18]">
          Fiskbarhedsindeks kommer snart
        </h2>
        <div className="mt-4 text-6xl font-light text-[#8A8A82] leading-none">
          —
        </div>
        <p className="mt-6 text-xs text-[#8A8A82]">
          Forbinder til DMI, CMEMS og Open-Meteo...
        </p>
      </div>
    </div>
  )
}
