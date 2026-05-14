'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Caveat } from 'next/font/google'
import { createClient } from '@/utils/supabase/client'

const caveat = Caveat({ subsets: ['latin'], weight: '500' })

export default function LoginPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Skriv venligst dit navn')
      return
    }
    setSubmitting(true)
    setError(null)

    const supabase = createClient()
    const { data, error: dbError } = await supabase
      .from('users')
      .upsert({ name: trimmed }, { onConflict: 'name' })
      .select()
      .single()

    if (dbError || !data) {
      setError(dbError?.message ?? 'Noget gik galt')
      setSubmitting(false)
      return
    }

    localStorage.setItem(
      'pighvar_user',
      JSON.stringify({ id: data.id, name: data.name }),
    )
    router.push('/dashboard')
  }

  return (
    <main className="min-h-screen bg-[#F7F6F3] flex items-center justify-center px-4 font-sans">
      <div className="w-80 bg-white rounded-2xl border border-gray-200 shadow-sm p-8 flex flex-col items-center">
        <svg viewBox="0 0 80 80" className="w-16 h-16 mb-4" aria-hidden="true">
          <circle cx="40" cy="40" r="32" fill="none" stroke="#1f2937" strokeWidth="1.5" />
          <circle cx="40" cy="40" r="28" fill="none" stroke="#9ca3af" strokeWidth="0.5" />
          <text x="40" y="12" textAnchor="middle" fontSize="7" fill="#1f2937" fontWeight="600">N</text>
          <text x="40" y="74" textAnchor="middle" fontSize="7" fill="#1f2937">S</text>
          <text x="71" y="42.5" textAnchor="middle" fontSize="7" fill="#1f2937">E</text>
          <text x="9" y="42.5" textAnchor="middle" fontSize="7" fill="#1f2937">W</text>
          <g transform="rotate(112.5 40 40)">
            <polygon points="40,12 36,40 44,40" fill="#2563eb" />
            <polygon points="40,68 36,40 44,40" fill="#9ca3af" />
          </g>
          <circle cx="40" cy="40" r="2" fill="#1f2937" />
        </svg>

        <h1 className={`${caveat.className} text-3xl text-gray-900 leading-tight`}>
          Pighvar · Vestkysten
        </h1>
        <p className="text-xs text-gray-500 mt-1 tracking-wide tabular-nums">
          55°33′N · 08°05′E
        </p>

        <form onSubmit={handleSubmit} className="w-full mt-8 flex flex-col gap-4">
          <label htmlFor="name" className="text-base text-gray-900">
            Hvad hedder du?
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Dit navn..."
            autoFocus
            autoComplete="off"
            className="border-b border-gray-300 focus:border-gray-900 outline-none py-2 bg-transparent text-gray-900 placeholder-gray-400 transition-colors"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full mt-2 bg-black text-white rounded-lg py-2.5 text-sm font-medium hover:bg-gray-900 disabled:opacity-60 transition-colors"
          >
            {submitting ? 'Logger ind...' : 'Log ind'}
          </button>
        </form>
      </div>
    </main>
  )
}
