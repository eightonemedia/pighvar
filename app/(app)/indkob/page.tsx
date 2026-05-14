'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createClient } from '@/utils/supabase/client'
import type { AppUser, ShoppingItem } from '@/types'

const CATEGORIES = ['Agn', 'Grej', 'Tøj', 'Mad', 'Andet'] as const
type Category = (typeof CATEGORIES)[number]

const CATEGORY_COLORS: Record<Category, string> = {
  Agn: 'bg-[#E3F2DA] text-[#3D6B27]',
  Grej: 'bg-[#E7EEF4] text-[#1A5A8A]',
  Tøj: 'bg-[#F5ECD9] text-[#B5811C]',
  Mad: 'bg-[#EDE3F2] text-[#6B3D8A]',
  Andet: 'bg-[#EFECE7] text-[#4A4A44]',
}

const SEED_ITEMS: { name: string; category: Category }[] = [
  { name: 'Tobis (frosne)', category: 'Agn' },
  { name: 'GULP Tobis', category: 'Agn' },
  { name: 'Pirke 40-80g sølv', category: 'Grej' },
  { name: 'Agn-elastik', category: 'Grej' },
  { name: 'Fluorocarbon 0.40mm', category: 'Grej' },
]

type LocalUser = { id: string; name: string }

export default function IndkobPage() {
  const [user, setUser] = useState<LocalUser | null>(null)
  const [items, setItems] = useState<ShoppingItem[]>([])
  const [users, setUsers] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [isLive, setIsLive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formCategory, setFormCategory] = useState<Category>('Agn')
  const [formLink, setFormLink] = useState('')
  const seededRef = useRef(false)

  useEffect(() => {
    const stored = localStorage.getItem('pighvar_user')
    if (stored) {
      try {
        setUser(JSON.parse(stored) as LocalUser)
      } catch {
        // The (app) layout already handles malformed user state.
      }
    }

    const supabase = createClient()

    const refetchItems = async () => {
      const res = await supabase
        .from('shopping_items')
        .select('*')
        .order('created_at', { ascending: true })
      if (!res.error) setItems((res.data ?? []) as ShoppingItem[])
    }

    const init = async () => {
      const [itemsRes, usersRes] = await Promise.all([
        supabase
          .from('shopping_items')
          .select('*')
          .order('created_at', { ascending: true }),
        supabase.from('users').select('id, name'),
      ])

      if (itemsRes.error) {
        setError(itemsRes.error.message)
      } else {
        const fetched = (itemsRes.data ?? []) as ShoppingItem[]
        setItems(fetched)

        if (fetched.length === 0 && !seededRef.current) {
          seededRef.current = true
          const seedErr = await supabase
            .from('shopping_items')
            .insert(SEED_ITEMS)
          if (!seedErr.error) await refetchItems()
        }
      }
      if (!usersRes.error) {
        setUsers((usersRes.data ?? []) as AppUser[])
      }
      setLoading(false)
    }
    init()

    const channel = supabase
      .channel('shopping_items_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shopping_items' },
        () => {
          refetchItems()
        },
      )
      .subscribe((status) => {
        setIsLive(status === 'SUBSCRIBED')
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    const trimmed = formName.trim()
    if (!trimmed) return
    const supabase = createClient()
    const { error: insertErr } = await supabase
      .from('shopping_items')
      .insert({
        name: trimmed,
        category: formCategory,
        link: formLink.trim() || null,
      })
    if (insertErr) {
      setError(insertErr.message)
      return
    }
    setFormName('')
    setFormLink('')
  }

  async function toggleBought(item: ShoppingItem) {
    if (!user) return
    const supabase = createClient()
    const patch = item.bought
      ? { bought: false, bought_by_user_id: null, bought_at: null }
      : {
          bought: true,
          bought_by_user_id: user.id,
          bought_at: new Date().toISOString(),
        }
    // Optimistic update — realtime will reconcile.
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, ...patch } : i)),
    )
    const { error: upErr } = await supabase
      .from('shopping_items')
      .update(patch)
      .eq('id', item.id)
    if (upErr) setError(upErr.message)
  }

  const usersById = useMemo(() => {
    const m = new Map<string, string>()
    for (const u of users) m.set(u.id, u.name)
    return m
  }, [users])

  const sorted = useMemo(() => {
    return [...items].sort((a, b) => {
      if (a.bought !== b.bought) return a.bought ? 1 : -1
      return a.id.localeCompare(b.id)
    })
  }, [items])

  const totalCount = items.length
  const boughtCount = items.filter((i) => i.bought).length

  return (
    <div className="max-w-4xl space-y-6 pb-12">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#1A1A18]">
            Indkøbsliste
          </h1>
          {!loading && (
            <p className="text-sm text-[#8A8A82] mt-1 tabular-nums">
              {totalCount} varer · {boughtCount} købt
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-[#8A8A82]">
          <span
            className={`w-2 h-2 rounded-full ${
              isLive ? 'bg-[#1F8A4C]' : 'bg-[#E0DDD6]'
            }`}
          />
          {isLive ? 'Live' : 'Forbinder...'}
        </div>
      </div>

      <Card className="p-4">
        <form
          onSubmit={handleAdd}
          className="flex flex-wrap gap-2 items-center"
        >
          <input
            type="text"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder="Tilføj vare..."
            className="flex-1 min-w-[200px] border border-[#E0DDD6] rounded px-3 py-1.5 text-sm focus:outline-none focus:border-[#1A1A18]"
          />
          <select
            value={formCategory}
            onChange={(e) => setFormCategory(e.target.value as Category)}
            className="border border-[#E0DDD6] rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:border-[#1A1A18]"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={formLink}
            onChange={(e) => setFormLink(e.target.value)}
            placeholder="Link (valgfri)"
            className="w-48 border border-[#E0DDD6] rounded px-3 py-1.5 text-sm focus:outline-none focus:border-[#1A1A18]"
          />
          <button
            type="submit"
            disabled={!formName.trim()}
            className="bg-[#1A1A18] text-white px-4 py-1.5 rounded text-sm font-medium disabled:opacity-50 hover:bg-[#000] transition-colors"
          >
            Tilføj
          </button>
        </form>
      </Card>

      {loading ? (
        <Card className="p-6">
          <p className="text-sm text-[#8A8A82]">Indlæser...</p>
        </Card>
      ) : error ? (
        <Card className="p-6">
          <p className="text-sm text-red-600">{error}</p>
        </Card>
      ) : items.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-[#8A8A82]">
            Ingen varer på listen endnu
          </p>
        </Card>
      ) : (
        <Card>
          <ul>
            {sorted.map((item) => {
              const buyerName = item.bought_by_user_id
                ? (usersById.get(item.bought_by_user_id) ?? null)
                : null
              const badgeClass =
                CATEGORY_COLORS[item.category as Category] ??
                CATEGORY_COLORS.Andet
              return (
                <li
                  key={item.id}
                  className="flex items-center gap-3 px-4 py-3 border-t border-[#EFECE7] first:border-t-0"
                >
                  <input
                    type="checkbox"
                    checked={item.bought}
                    onChange={() => toggleBought(item)}
                    className="w-4 h-4 accent-[#1A1A18] cursor-pointer shrink-0"
                  />
                  <span
                    className={`flex-1 text-sm ${
                      item.bought
                        ? 'line-through text-[#8A8A82]'
                        : 'text-[#1A1A18]'
                    }`}
                  >
                    {item.name}
                  </span>
                  <span
                    className={`px-2 py-0.5 text-[11px] rounded-full ${badgeClass}`}
                  >
                    {item.category}
                  </span>
                  {item.link && (
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[#1A5A8A] hover:underline"
                    >
                      Link
                    </a>
                  )}
                  {item.bought && buyerName && (
                    <span className="text-xs text-[#8A8A82] whitespace-nowrap">
                      af {buyerName}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </Card>
      )}
    </div>
  )
}

function Card({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`bg-white border border-[#E0DDD6] rounded-xl ${className}`}
    >
      {children}
    </div>
  )
}
