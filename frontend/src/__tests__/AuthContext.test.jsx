import React from 'react'
import { vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext, AuthProvider } from '../contexts/AuthContext'

// ---------------------------------------------------------------------------
// Mock the api module (the interceptor-wrapped axios instance)
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
  // Also export named helpers used by AuthContext
  return {
    default: api,
    setAccessToken: vi.fn(),
    getAccessToken: vi.fn(),
  }
})

// Mock bare axios (used for the silent refresh + CSRF token calls)
vi.mock('axios', () => {
  const axiosMock = {
    post: vi.fn(),
    get: vi.fn(),
  }
  return { default: axiosMock }
})

import api, { setAccessToken } from '../lib/api'
import axios from 'axios'

// ---------------------------------------------------------------------------
// Helper: AuthProvider requires a Router because it uses useNavigate()
// ---------------------------------------------------------------------------
function renderWithRouter(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

// ---------------------------------------------------------------------------
// Consumer component that exposes context values
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
// Reset mocks before every test
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('AuthContext — initial state (no token)', () => {
  it('starts with loading=true and resolves to loading=false', async () => {
    // Silent refresh fails (no cookie) → loading resolves to false
    axios.post.mockRejectedValueOnce(new Error('no cookie'))

    renderWithRouter(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('loading').textContent).toBe('false'),
    )
  })

  it('user is null when no token exists', async () => {
    axios.post.mockRejectedValueOnce(new Error('no cookie'))

    renderWithRouter(
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

describe('AuthContext — token present on mount (silent refresh)', () => {
  it('calls silent refresh then GET /api/auth/me and sets user', async () => {
    // Silent refresh succeeds
    axios.post.mockResolvedValueOnce({ data: { access_token: 'new-token' } })
    // /api/auth/me returns a user
    api.get.mockResolvedValueOnce({ data: { username: 'alice' } })

    renderWithRouter(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('user').textContent).toBe('alice'),
    )
    expect(api.get).toHaveBeenCalledWith('/api/auth/me')
  })

  it('stays logged out and sets loading=false when silent refresh fails', async () => {
    axios.post.mockRejectedValueOnce(new Error('Unauthorized'))

    renderWithRouter(
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

describe('AuthContext — login', () => {
  it('calls api.post then api.get and sets user on successful login', async () => {
    // On mount silent refresh fails
    axios.post.mockRejectedValueOnce(new Error('no cookie'))

    renderWithRouter(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('loading').textContent).toBe('false'),
    )

    // Login call: api.post returns access_token; CSRF fetch succeeds; api.get returns user
    api.post.mockResolvedValueOnce({
      data: { access_token: 'tok-123', refresh_token: 'ref-abc' },
    })
    axios.get.mockResolvedValueOnce({})      // CSRF token fetch
    api.get.mockResolvedValueOnce({ data: { username: 'bob' } })

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

  it('stores access token in memory (setAccessToken) after successful login', async () => {
    axios.post.mockRejectedValueOnce(new Error('no cookie'))

    renderWithRouter(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('loading').textContent).toBe('false'),
    )

    api.post.mockResolvedValueOnce({
      data: { access_token: 'tok-xyz', refresh_token: 'ref-xyz' },
    })
    axios.get.mockResolvedValueOnce({})     // CSRF token fetch
    api.get.mockResolvedValueOnce({ data: { username: 'carol' } })

    await act(async () => {
      screen.getByTestId('login-btn').click()
    })

    await waitFor(() =>
      expect(screen.getByTestId('user').textContent).toBe('carol'),
    )

    // Token must go to in-memory store, NOT localStorage
    expect(setAccessToken).toHaveBeenCalledWith('tok-xyz')
    expect(localStorage.getItem('access_token')).toBeNull()
    expect(localStorage.getItem('refresh_token')).toBeNull()
  })
})

describe('AuthContext — logout', () => {
  it('clears user and in-memory token on logout', async () => {
    // Silent refresh succeeds → user is logged in
    axios.post.mockResolvedValueOnce({ data: { access_token: 'live-token' } })
    api.get.mockResolvedValueOnce({ data: { username: 'dave' } })

    renderWithRouter(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('user').textContent).toBe('dave'),
    )

    // Logout: backend call succeeds
    api.post.mockResolvedValueOnce({ data: { message: 'Logged out' } })

    await act(async () => {
      screen.getByTestId('logout-btn').click()
    })

    await waitFor(() =>
      expect(screen.getByTestId('user').textContent).toBe('none'),
    )
    // setAccessToken should have been called with null (clear in-memory token)
    expect(setAccessToken).toHaveBeenCalledWith(null)
    // localStorage must never have been used
    expect(localStorage.getItem('access_token')).toBeNull()
    expect(localStorage.getItem('refresh_token')).toBeNull()
  })
})
