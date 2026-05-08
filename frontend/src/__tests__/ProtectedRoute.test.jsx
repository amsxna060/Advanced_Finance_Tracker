import React from 'react'
import { vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ProtectedRoute from '../components/ProtectedRoute'

// ---------------------------------------------------------------------------
// Mock the useAuth hook so we control what it returns in each test
// ---------------------------------------------------------------------------
vi.mock('../hooks/useAuth')
import { useAuth } from '../hooks/useAuth'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderRoute(ui) {
  return render(<MemoryRouter initialEntries={['/']}>{ui}</MemoryRouter>)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders "Loading..." text while auth is still initialising', () => {
    useAuth.mockReturnValue({ user: null, loading: true })

    renderRoute(
      <ProtectedRoute>
        <div>Protected content</div>
      </ProtectedRoute>,
    )

    expect(screen.getByText('Loading...')).toBeInTheDocument()
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
  })

  it('does not render children when loading is true', () => {
    useAuth.mockReturnValue({ user: null, loading: true })

    renderRoute(
      <ProtectedRoute>
        <span data-testid="secret">secret</span>
      </ProtectedRoute>,
    )

    expect(screen.queryByTestId('secret')).not.toBeInTheDocument()
  })

  it('redirects to /login when user is null and loading is false', () => {
    useAuth.mockReturnValue({ user: null, loading: false })

    // Render inside a MemoryRouter with a /login route so Navigate has somewhere to go
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <ProtectedRoute>
          <div>Dashboard</div>
        </ProtectedRoute>
      </MemoryRouter>,
    )

    // Children must not appear; the Navigate component handles the redirect
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()
  })

  it('renders children when user is set and loading is false', () => {
    useAuth.mockReturnValue({ user: { username: 'alice' }, loading: false })

    renderRoute(
      <ProtectedRoute>
        <div data-testid="protected-page">Welcome Alice</div>
      </ProtectedRoute>,
    )

    expect(screen.getByTestId('protected-page')).toBeInTheDocument()
    expect(screen.getByText('Welcome Alice')).toBeInTheDocument()
  })

  it('does not render the loading spinner when the user is authenticated', () => {
    useAuth.mockReturnValue({ user: { username: 'bob' }, loading: false })

    renderRoute(
      <ProtectedRoute>
        <p>Content</p>
      </ProtectedRoute>,
    )

    expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
  })
})
