import React from 'react'
import { vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { hasModule, QUESTIONNAIRE, DEFAULT_MODULES, CORE_KEYS } from '../lib/modules'
import RequireModule from '../components/RequireModule'

vi.mock('../hooks/useAuth')
import { useAuth } from '../hooks/useAuth'

describe('hasModule', () => {
  it('treats null enabled_modules as all modules (legacy accounts)', () => {
    expect(hasModule({ enabled_modules: null }, 'loans')).toBe(true)
    expect(hasModule({}, 'loans')).toBe(true)
  })

  it('respects an explicit module list', () => {
    const user = { enabled_modules: ['dashboard', 'expenses'] }
    expect(hasModule(user, 'expenses')).toBe(true)
    expect(hasModule(user, 'loans')).toBe(false)
  })

  it('untagged nav items are always visible', () => {
    expect(hasModule({ enabled_modules: [] }, undefined)).toBe(true)
  })
})

describe('questionnaire mapping', () => {
  it('every mapped module key is a real module', async () => {
    const { MODULES } = await import('../lib/modules')
    const known = new Set(MODULES.map((m) => m.key))
    for (const q of QUESTIONNAIRE) {
      for (const key of q.modules) {
        expect(known.has(key), `${q.id} maps unknown module ${key}`).toBe(true)
      }
    }
  })

  it('defaults include every core module', () => {
    for (const key of CORE_KEYS) {
      expect(DEFAULT_MODULES).toContain(key)
    }
  })
})

describe('RequireModule', () => {
  function renderGuarded(user) {
    useAuth.mockReturnValue({ user, loading: false })
    return render(
      <MemoryRouter initialEntries={['/loans']}>
        <Routes>
          <Route
            path="/loans"
            element={
              <RequireModule module="loans">
                <div>loans-page</div>
              </RequireModule>
            }
          />
          <Route path="/dashboard" element={<div>dashboard-page</div>} />
        </Routes>
      </MemoryRouter>
    )
  }

  beforeEach(() => vi.clearAllMocks())

  it('renders the page when the module is enabled', () => {
    renderGuarded({ enabled_modules: ['loans'] })
    expect(screen.getByText('loans-page')).toBeInTheDocument()
  })

  it('redirects to dashboard when the module is disabled', () => {
    renderGuarded({ enabled_modules: ['expenses'] })
    expect(screen.queryByText('loans-page')).not.toBeInTheDocument()
    expect(screen.getByText('dashboard-page')).toBeInTheDocument()
  })

  it('legacy users (null modules) see everything', () => {
    renderGuarded({ enabled_modules: null })
    expect(screen.getByText('loans-page')).toBeInTheDocument()
  })
})
