import React, { useState, useMemo } from 'react'
import Papa from 'papaparse'

type Row = Record<string, string>

type RestaurantStats = {
  name: string
  total: number
  positive: number
  negative: number
  positive_ratio: number
  negative_ratio: number
  lowVolume: boolean
  badge?: string
  riskLevel: string
}

const RISK_LABEL = (negRatio: number) => {
  if (negRatio >= 0.4) return 'Critical'
  if (negRatio >= 0.2) return 'Needs Improvement'
  if (negRatio >= 0.1) return 'Monitor'
  return 'Healthy'
}

export default function App() {
  const [sheetId, setSheetId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<Row[] | null>(null)

  const [search, setSearch] = useState('')
  const [riskFilter, setRiskFilter] = useState<string>('All')
  const [showLowVolume, setShowLowVolume] = useState(false)

  async function loadSheet() {
    setError(null)
    setRows(null)
    if (!sheetId) {
      setError('Please provide a Google Sheets ID.')
      return
    }
    setLoading(true)
    try {
      // Fetch sheet as CSV (first sheet)
      const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Failed to fetch sheet: ${res.statusText}`)
      const csv = await res.text()
      const parsed = Papa.parse<Row>(csv, { header: true, skipEmptyLines: true })
      if (parsed.errors.length) {
        console.warn('CSV parse errors', parsed.errors)
      }
      setRows(parsed.data)
    } catch (e: any) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  const stats = useMemo(() => {
    if (!rows) return null

    // heuristics for finding columns
    const headerKeys = rows.length ? Object.keys(rows[0]) : []
    const findCol = (candidates: string[]) => {
      const lower = headerKeys.map(h => h.toLowerCase())
      for (const cand of candidates) {
        const idx = lower.indexOf(cand.toLowerCase())
        if (idx !== -1) return headerKeys[idx]
      }
      // try fuzzy: contains
      for (const h of headerKeys) {
        for (const cand of candidates) {
          if (h.toLowerCase().includes(cand.toLowerCase())) return h
        }
      }
      return null
    }

    const nameCol = findCol(['restaurant', 'name', 'store', 'venue', 'location'])
    const ratingCol = findCol(['rating', 'score', 'stars', 'rate'])

    if (!nameCol || !ratingCol) return { error: 'Could not detect name or rating column. Expected columns like "restaurant" and "rating".' }

    const groups = new Map<string, { total: number; positive: number; negative: number }>()

    for (const r of rows) {
      const rawName = (r[nameCol] || '').trim()
      if (!rawName) continue
      const rawRating = (r[ratingCol] || '').trim()
      const rating = Number(rawRating)
      if (Number.isNaN(rating)) continue

      const g = groups.get(rawName) || { total: 0, positive: 0, negative: 0 }
      g.total++
      if (rating >= 4 && rating <= 5) g.positive++
      if (rating >= 1 && rating <= 2) g.negative++
      groups.set(rawName, g)
    }

    const arr: RestaurantStats[] = []
    for (const [name, g] of groups.entries()) {
      const total = g.total
      const positive = g.positive
      const negative = g.negative
      const positive_ratio = total ? positive / total : 0
      const negative_ratio = total ? negative / total : 0
      const lowVolume = total < 10
      const riskLevel = RISK_LABEL(negative_ratio)
      arr.push({ name, total, positive, negative, positive_ratio, negative_ratio, lowVolume, riskLevel })
    }

    // Ranking: exclude low volume from ranking
    const ranked = arr.filter(a => !a.lowVolume)
    const best = [...ranked].sort((a, b) => b.positive_ratio - a.positive_ratio).slice(0, 10)
    const worst = [...ranked].sort((a, b) => b.negative_ratio - a.negative_ratio).slice(0, 10)

    // assign badges
    const bestSet = new Set(best.map(b => b.name))
    const worstSet = new Set(worst.map(b => b.name))

    const result = arr.map(a => {
      const copy = { ...a }
      if (copy.lowVolume) copy.badge = '⏳ Low Volume – Not Ranked'
      else if (bestSet.has(copy.name)) copy.badge = '⭐ Top Performer'
      else if (copy.negative_ratio >= 0.4) copy.badge = '🚨 Critical'
      else if (copy.negative_ratio >= 0.2) copy.badge = '⚠ Needs Improvement'
      // Monitor/Healthy don't get special emoji badges here beyond the riskLevel label
      return copy
    })

    return { all: result, best, worst }
  }, [rows])

  const filtered = useMemo(() => {
    if (!stats) return null
    let list = stats.all
    if (search) {
      const s = search.toLowerCase()
      list = list.filter(r => r.name.toLowerCase().includes(s))
    }
    if (riskFilter !== 'All') {
      list = list.filter(r => r.riskLevel === riskFilter)
    }
    if (showLowVolume) list = list.filter(r => r.lowVolume)
    return list
  }, [stats, search, riskFilter, showLowVolume])

  return (
    <div className="app-root">
      <header className="topbar">
        <h1>CSAT Intelligence Dashboard</h1>
        <p className="subtitle">Connect to a Google Sheet by providing its Sheet ID. The sheet will be read as CSV and analyzed.</p>
      </header>

      <main className="container">
        <section className="card controls">
          <div className="row">
            <label>Google Sheet ID</label>
            <input value={sheetId} onChange={e => setSheetId(e.target.value)} placeholder="Enter Sheet ID (not full URL)" />
            <button onClick={loadSheet} disabled={loading}>{loading ? 'Loading…' : 'Load Sheet'}</button>
          </div>
          <div className="row small">
            <div>Parsing expects columns like "restaurant" (name) and "rating" (1-5).</div>
            <div className="spacer" />
            <div>
              <label>Filter:</label>
              <select value={riskFilter} onChange={e => setRiskFilter(e.target.value)}>
                <option>All</option>
                <option>Critical</option>
                <option>Needs Improvement</option>
                <option>Monitor</option>
                <option>Healthy</option>
              </select>
              <input className="search" placeholder="Search restaurants" value={search} onChange={e => setSearch(e.target.value)} />
              <label className="lv">
                <input type="checkbox" checked={showLowVolume} onChange={e => setShowLowVolume(e.target.checked)} /> Low volume only
              </label>
            </div>
          </div>

          {error && <div className="error">{error}</div>}
        </section>

        <section className="grid">
          <div className="card metrics">
            <h2>Top 10 — Best Restaurants (by positive ratio)</h2>
            <div className="list">
              {stats ? (
                stats.best.length ? stats.best.map((r, i) => (
                  <div key={r.name} className="item">
                    <div>
                      <div className="name">{i+1}. {r.name}</div>
                      <div className="meta">{Math.round(r.positive_ratio*100)}% positive • {r.total} reviews</div>
                    </div>
                    <div className="badges">
                      <span className="badge top">⭐ Top Performer</span>
                      <span className="badge small">{r.riskLevel}</span>
                    </div>
                  </div>
                )) : <div className="muted">No ranked restaurants (not enough data or sheet empty).</div>
              ) : <div className="muted">Load a sheet to see rankings.</div>}
            </div>
          </div>

          <div className="card metrics">
            <h2>Top 10 — Worst Restaurants (by negative ratio)</h2>
            <div className="list">
              {stats ? (
                stats.worst.length ? stats.worst.map((r, i) => (
                  <div key={r.name} className="item">
                    <div>
                      <div className="name">{i+1}. {r.name}</div>
                      <div className="meta">{Math.round(r.negative_ratio*100)}% negative • {r.total} reviews</div>
                    </div>
                    <div className="badges">
                      <span className={`badge ${r.badge?.includes('Critical') ? 'critical' : ''}`}>{r.badge ? r.badge : r.riskLevel}</span>
                    </div>
                  </div>
                )) : <div className="muted">No ranked restaurants (not enough data or sheet empty).</div>
              ) : <div className="muted">Load a sheet to see rankings.</div>}
            </div>
          </div>

          <div className="card table">
            <h2>All Restaurants</h2>
            <div className="list">
              {filtered ? filtered.map(r => (
                <div key={r.name} className="rowItem">
                  <div className="left">
                    <div className="name">{r.name}</div>
                    <div className="meta">{r.total} reviews</div>
                  </div>
                  <div className="center">
                    <div className="ratio">✅ {Math.round(r.positive_ratio*100)}%</div>
                    <div className="ratio neg">❌ {Math.round(r.negative_ratio*100)}%</div>
                  </div>
                  <div className="right">
                    <div className="risk">{r.riskLevel}</div>
                    {r.badge && <div className="badge inline">{r.badge}</div>}
                  </div>
                </div>
              )) : <div className="muted">Load a sheet to view restaurants.</div>}
            </div>
          </div>
        </section>

        <section className="card footer">
          <div>Notes:</div>
          <ul>
            <li>positive_ratio = count(rating 4–5) / total reviews</li>
            <li>negative_ratio = count(rating 1–2) / total reviews</li>
            <li>Low Volume = restaurants with &lt; 10 reviews (these are not ranked)</li>
            <li>Risk levels applied to negative_ratio: ≥40% Critical, 20–39% Needs Improvement, 10–19% Monitor, &lt;10% Healthy</li>
            <li>Average rating is not used anywhere.</li>
          </ul>
        </section>

      </main>

    </div>
  )
}
