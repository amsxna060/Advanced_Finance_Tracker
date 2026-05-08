import React from 'react'
import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

// ---------------------------------------------------------------------------
// Mocks — must be declared before any imports that pull in the mocked modules
// ---------------------------------------------------------------------------
vi.mock('../hooks/useAuth')
import { useAuth } from '../hooks/useAuth'

// Capture the navigate mock so we can assert calls
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

import Login from '../pages/Login'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderLogin(authOverrides = {}) {
  const defaultAuth = {
    user: null,
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }
  useAuth.mockReturnValue({ ...defaultAuth, ...authOverrides })

  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Login />
    </MemoryRouter>,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Login page — rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the username input field', () => {
    renderLogin()
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument()
  })

  it('renders the password input field', () => {
    renderLogin()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
  })

  it('renders a submit / sign-in button', () => {
    renderLogin()
    expect(
      screen.getByRole('button', { name: /sign in/i }),
    ).toBeInTheDocument()
  })

  it('shows a loading spinner when auth is initialising', () => {
    // When authLoading=true the page renders a spinner div, not the form
    renderLogin({ loading: true })
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument()
  })

  it('redirects to dashboard when a user is already authenticated', () => {
    renderLogin({ user: { username: 'alice' }, loading: false })
    // Navigate replaces the route; the form should not be visible
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument()
  })
})

describe('Login page — form submission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls login() with the typed username and password', async () => {
    const loginMock = vi.fn().mockResolvedValue({ username: 'alice' })
    renderLogin({ login: loginMock })

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/username/i), 'alice')
    await user.type(screen.getByLabelText(/password/i), 'hunter2')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith('alice', 'hunter2')
    })
  })

  it('navigates to /dashboard after a successful login', async () => {
    const loginMock = vi.fn().mockResolvedValue({ username: 'alice' })
    renderLogin({ login: loginMock })

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/username/i), 'alice')
    await user.type(screen.getByLabelText(/password/i), 'hunter2')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard')
    })
  })

  it('displays an error message when login fails with a server detail', async () => {
    const error = { response: { data: { detail: 'Invalid credentials' } } }
    const loginMock = vi.fn().mockRejectedValue(error)
    renderLogin({ login: loginMock })

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/username/i), 'wrong')
    await user.type(screen.getByLabelText(/password/i), 'wrong')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument()
    })
  })

  it('displays a generic error message when login fails without a detail field', async () => {
    const loginMock = vi.fn().mockRejectedValue(new Error('Network Error'))
    renderLogin({ login: loginMock })

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/username/i), 'alice')
    await user.type(screen.getByLabelText(/password/i), 'bad')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(
        screen.getByText(/login failed/i),
      ).toBeInTheDocument()
    })
  })

  it('shows "Signing in..." on the button while the request is in-flight', async () => {
    // login resolves only after a manual trigger so we can observe the interim state
    let resolveFn
    const loginMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFn = resolve
        }),
    )
    renderLogin({ login: loginMock })

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/username/i), 'alice')
    await user.type(screen.getByLabelText(/password/i), 'secret')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    // While the promise is pending, the button text should change
    expect(screen.getByRole('button', { name: /signing in/i })).toBeInTheDocument()

    // Resolve so we don't leave a dangling promise
    resolveFn({ username: 'alice' })
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /signing in/i })).not.toBeInTheDocument(),
    )
  })
})
