import React from 'react'
import { vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { AuthContext, AuthProvider } from '../contexts/AuthContext'

// ---------------------------------------------------------------------------
// Mock the api module
// ---------------------------------------------------------------------------
vi.mock('../lib/api', () => {
  const api = {
    get: vi.fn(),
    post: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
    defaults: { headers: { common: {} } },
  }
  return { default: api }
})

// Import the mocked api AFTER vi.mock so the module factory has run
import api from '../lib/api'

// ---------------------------------------------------------------------------
// Helper: consumer component that exposes context values
// ---------------------------------------------------------------------------
function AuthConsumer() {
  return (
    <AuthContext.Consumer>
      {({ user, loading, login, logout }) => (
        <div>
          <span data-testid="loading">{String(loading)}</span>
          <span data-testid="user">{user ? user.username : 'none'}</span>
          <button data-testid="login-btn" onClick={() => login('alice', 'secret')} />
          <button data-testid="logout-btn" onClick={() => logout()} />
        </div>
      )}
    </AuthContext.Consumer>
  )
}

// ---------------------------------------------------------------------------
// Reset mocks and localStorage before every test
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('AuthContext — initial state (no token)', () => {
  it('starts with loading=true and resolves to loading=false', async () => {
    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    )

    // After the effect resolves, loading should be false
    await waitFor(() =>
      expect(screen.getByTestId('loading').textContent).toBe('false'),
    )
  })

  it('user is null when no token exists', async () => {
    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('loading').textContent).toBe('false'),
    )
    expect(screen.getByTestId('user').textContent).toBe('none')
  })
})

describe('AuthContext — token present on mount', () => {
  it('calls GET /api/auth/me and sets user when access_token exists', async () => {
    localStorage.setItem('access_token', 'existing-token')
    api.get.mockResolvedValueOnce({ data: { username: 'alice' } })

    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('user').textContent).toBe('alice'),
    )
    expect(api.get).toHaveBeenCalledWith('/api/auth/me')
  })

  it('clears access_token from localStorage when /auth/me fails', async () => {
    localStorage.setItem('access_token', 'bad-token')
    localStorage.setItem('refresh_token', 'bad-refresh')
    api.get.mockRejectedValueOnce(new Error('Unauthorized'))

    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('loading').textContent).toBe('false'),
    )
    expect(localStorage.getItem('access_token')).toBeNull()
  })
})

describe('AuthContext — login', () => {
  it('calls api.post then api.get and sets user on successful login', async () => {
    api.post.mockResolvedValueOnce({
      data: { access_token: 'tok-123', refresh_token: 'ref-abc' },
    })
    api.get.mockResolvedValueOnce({ data: { username: 'bob' } })

    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('loading').textContent).toBe('false'),
    )

    await act(async () => {
      screen.getByTestId('login-btn').click()
    })

    await waitFor(() =>
      expect(screen.getByTestId('user').textContent).toBe('bob'),
    )

    expect(api.post).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.any(FormData),
      expect.objectContaining({ headers: expect.any(Object) }),
    )
    expect(api.get).toHaveBeenCalledWith('/api/auth/me')
  })

  it('stores tokens in localStorage after successful login', async () => {
    api.post.mockResolvedValueOnce({
      data: { access_token: 'tok-xyz', refresh_token: 'ref-xyz' },
    })
    api.get.mockResolvedValueOnce({ data: { username: 'carol' } })

    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('loading').textContent).toBe('false'),
    )

    await act(async () => {
      screen.getByTestId('login-btn').click()
    })

    await waitFor(() =>
      expect(localStorage.getItem('access_token')).toBe('tok-xyz'),
    )
    expect(localStorage.getItem('refresh_token')).toBe('ref-xyz')
  })
})

describe('AuthContext — logout', () => {
  it('clears user and removes tokens from localStorage', async () => {
    // Set up a logged-in state first
    localStorage.setItem('access_token', 'live-token')
    api.get.mockResolvedValueOnce({ data: { username: 'dave' } })

    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('user').textContent).toBe('dave'),
    )

    await act(async () => {
      screen.getByTestId('logout-btn').click()
    })

    expect(screen.getByTestId('user').textContent).toBe('none')
    expect(localStorage.getItem('access_token')).toBeNull()
    expect(localStorage.getItem('refresh_token')).toBeNull()
  })
})
