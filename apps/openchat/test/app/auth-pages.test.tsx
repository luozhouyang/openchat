// @vitest-environment jsdom
// Auth pages (login/signup/check-email/verify-email) rendered via the real
// router; the shared composition root (@/app-client) is mocked so no network
// happens — these pages MUST go through appClient.auth (review #14): that is
// the only path that persists a bearer token for desktop file:// mode.
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "@/routeTree.gen";
import { setLanguage } from "@/i18n";

const mockSignIn = vi.hoisted(() => vi.fn());
const mockSignUp = vi.hoisted(() => vi.fn());
const mockSendVerificationEmail = vi.hoisted(() => vi.fn());
const mockVerifyEmail = vi.hoisted(() => vi.fn());

vi.mock("@/app-client", () => ({
  appClient: {
    auth: {
      signIn: mockSignIn,
      signUp: mockSignUp,
      sendVerificationEmail: mockSendVerificationEmail,
      verifyEmail: mockVerifyEmail,
      // AuthService contract returns a plain boolean (services/auth.ts hasSession).
      hasSession: vi.fn(async () => true),
    },
  },
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    getSession: vi.fn(async () => ({ data: null, error: null })),
    admin: {
      listUsers: vi.fn(),
      banUser: vi.fn(),
      unbanUser: vi.fn(),
    },
  },
}));
// __root.tsx pulls in the ws client singleton; auth pages never touch it.
vi.mock("@/ws/client", () => ({
  wsClient: { ensureConnected: async () => {}, sendActivity: () => {}, send: () => {} },
}));

const queryClient = new QueryClient();

afterEach(cleanup);
afterEach(() => setLanguage("en"));

async function renderRoute(path: string, search?: Record<string, string>) {
  const router = createRouter({ routeTree });
  if (search) {
    await router.navigate({ to: path, search } as never);
  } else {
    await router.navigate({ to: path } as never);
  }
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("login page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignIn.mockResolvedValue(undefined);
  });

  it("renders the login card", async () => {
    await renderRoute("/auth/login");
    expect(await screen.findByText("Sign in to openchat")).toBeInTheDocument();
  });

  it("shows field errors and does not submit an empty form", async () => {
    await renderRoute("/auth/login");
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByTestId("email-field-error")).toHaveTextContent(
      "Enter a valid email address",
    );
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it("associates labels with the email and password inputs", async () => {
    await renderRoute("/auth/login");
    const email = screen.getByLabelText("Email");
    expect(email).toHaveAttribute("id", "email");
    expect(email).toHaveAttribute("name", "email");
    expect(screen.getByLabelText("Password")).toHaveAttribute("id", "password");
  });

  it("submits valid credentials to the shared appClient.auth.signIn", async () => {
    await renderRoute("/auth/login");
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "alice@test.dev" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "password" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }));
    await vi.waitFor(() => expect(mockSignIn).toHaveBeenCalledWith("alice@test.dev", "password"));
  });

  it("shows the server error in a destructive alert", async () => {
    mockSignIn.mockRejectedValueOnce(new Error("密码错误"));
    await renderRoute("/auth/login");
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "alice@test.dev" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "wrong" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("密码错误")).toBeInTheDocument();
  });

  it("switches to Chinese via the language switcher", async () => {
    await renderRoute("/auth/login");
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(await screen.findByText("登录 openchat")).toBeInTheDocument();
  });
});

describe("signup page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignUp.mockResolvedValue(undefined);
  });

  it("shows a short-password error", async () => {
    await renderRoute("/auth/signup");
    fireEvent.change(screen.getByPlaceholderText("Your name"), { target: { value: "Alice" } });
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "alice@test.dev" },
    });
    fireEvent.change(screen.getByPlaceholderText("At least 8 characters"), {
      target: { value: "short" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Sign up" }));
    expect(await screen.findByTestId("password-field-error")).toHaveTextContent(
      "Password must be at least 8 characters",
    );
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it("submits to the shared appClient.auth.signUp and navigates to /check-email", async () => {
    await renderRoute("/auth/signup");
    fireEvent.change(screen.getByPlaceholderText("Your name"), { target: { value: "Alice" } });
    fireEvent.change(screen.getByPlaceholderText("Your unique username"), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "alice@test.dev" },
    });
    fireEvent.change(screen.getByPlaceholderText("At least 8 characters"), {
      target: { value: "alice-password" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Sign up" }));
    await vi.waitFor(() =>
      expect(mockSignUp).toHaveBeenCalledWith("alice@test.dev", "alice-password", {
        name: "Alice",
        username: "alice",
        callbackURL: "/auth/verify-email",
      }),
    );
    expect(await screen.findByText("Verify your email")).toBeInTheDocument();
  });
});

describe("check-email page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendVerificationEmail.mockResolvedValue(undefined);
  });

  it("renders the target email and resends via appClient.auth", async () => {
    await renderRoute("/auth/check-email", { email: "alice@test.dev" });
    expect(await screen.findByText("Verify your email")).toBeInTheDocument();
    expect(screen.getByText(/alice@test\.dev/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resend verification email" }));
    await vi.waitFor(() =>
      expect(mockSendVerificationEmail).toHaveBeenCalledWith("alice@test.dev"),
    );
  });
});

describe("verify-email page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyEmail.mockResolvedValue(undefined);
    mockSendVerificationEmail.mockResolvedValue(undefined);
  });

  it("shows the success state with workspace/login actions", async () => {
    await renderRoute("/auth/verify-email");
    expect(await screen.findByText("Email verified")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enter workspace" })).toBeInTheDocument();
  });

  it("shows the failure state when error is present", async () => {
    await renderRoute("/auth/verify-email", { error: "invalid_token", email: "alice@test.dev" });
    expect(await screen.findByText("Verification failed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resend verification email" }));
    await vi.waitFor(() =>
      expect(mockSendVerificationEmail).toHaveBeenCalledWith("alice@test.dev"),
    );
  });

  it("verifies via the token query when present", async () => {
    await renderRoute("/auth/verify-email", { token: "tok-1" });
    await vi.waitFor(() => expect(mockVerifyEmail).toHaveBeenCalledWith("tok-1"));
    expect(await screen.findByText("Email verified")).toBeInTheDocument();
  });

  it("shows a failure alert when resending the verification email fails", async () => {
    mockSendVerificationEmail.mockRejectedValueOnce(new Error("Send failed"));
    await renderRoute("/auth/verify-email", { error: "invalid_token", email: "alice@test.dev" });
    fireEvent.click(screen.getByRole("button", { name: "Resend verification email" }));
    expect(await screen.findAllByText("Send failed")).toHaveLength(2);
  });

  it("shows a success alert after resending the verification email", async () => {
    await renderRoute("/auth/verify-email", { error: "invalid_token", email: "alice@test.dev" });
    fireEvent.click(screen.getByRole("button", { name: "Resend verification email" }));
    expect(await screen.findByText("Sent")).toBeInTheDocument();
  });
});
