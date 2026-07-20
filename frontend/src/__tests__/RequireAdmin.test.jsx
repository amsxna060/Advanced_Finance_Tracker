import React from 'react'
import { vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import RequireAdmin from '../components/RequireAdmin'

vi.mock('../hooks/useAuth')
import { useAuth } from '../hooks/useAuth'

function renderGuarded() {
  return render(
    <MemoryRouter initialEntries={['/admin/migration']}>
      <Routes>
        <Route
          path="/admin/migration"
          element={
            <RequireAdmin>
              <div>admin-only-content</div>
            </RequireAdmin>
          }
        />
        <Route path="/dashboard" element={<div>dashboard-page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('RequireAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders children for a platform admin', () => {
    useAuth.mockReturnValue({ user: { role: 'admin' }, loading: false })
    renderGuarded()
    expect(screen.getByText('admin-only-content')).toBeInTheDocument()
  })

  it('redirects normal users to the dashboard', () => {
    useAuth.mockReturnValue({ user: { role: 'viewer' }, loading: false })
    renderGuarded()
    expect(screen.queryByText('admin-only-content')).not.toBeInTheDocument()
    expect(screen.getByText('dashboard-page')).toBeInTheDocument()
  })

  it('redirects readonly users to the dashboard', () => {
    useAuth.mockReturnValue({ user: { role: 'readonly' }, loading: false })
    renderGuarded()
    expect(screen.queryByText('admin-only-content')).not.toBeInTheDocument()
    expect(screen.getByText('dashboard-page')).toBeInTheDocument()
  })
})
