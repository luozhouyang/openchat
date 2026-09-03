// @vitest-environment jsdom
// Auth pages (login/signup/check-email/verify-email) rendered via the real
// router; the better-auth client (lib/auth-client.ts) is mocked so no network
// happens. Pages call authClient directly (not the state AuthService).
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "../../src/react-app/routeTree.gen";
import * as authClientMod from "../../src/react-app/lib/auth-client";

vi.mock("../../src/react-app/lib/auth-client", () => ({
  authClient: {
    signIn: { email: vi.fn() },
    signUp: { email: vi.fn() },
    sendVerificationEmail: vi.fn(),
    verifyEmail: vi.fn(),
    getSession: vi.fn(async () => ({ data: null, error: null })),
  },
}));

const auth = vi.mocked(authClientMod.authClient, true);

const queryClient = new QueryClient();

afterEach(cleanup);

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
    auth.signIn.email.mockResolvedValue({ data: null, error: null });
  });

  it("renders the login card", async () => {
    await renderRoute("/login");
    expect(await screen.findByText("登录 openchat")).toBeInTheDocument();
  });

  it("shows field errors and does not submit an empty form", async () => {
    await renderRoute("/login");
    fireEvent.submit(screen.getByRole("button", { name: "登录" }));
    expect(await screen.findByTestId("email-field-error")).toHaveTextContent(
      "请输入有效的邮箱地址",
    );
    expect(auth.signIn.email).not.toHaveBeenCalled();
  });

  it("submits valid credentials to authClient.signIn.email", async () => {
    await renderRoute("/login");
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "alice@test.dev" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "password" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "登录" }));
    await vi.waitFor(() =>
      expect(auth.signIn.email).toHaveBeenCalledWith({
        email: "alice@test.dev",
        password: "password",
      }),
    );
  });

  it("shows the server error in a destructive alert", async () => {
    auth.signIn.email.mockRejectedValueOnce(new Error("密码错误"));
    await renderRoute("/login");
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "alice@test.dev" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "wrong" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "登录" }));
    expect(await screen.findByText("密码错误")).toBeInTheDocument();
  });
});

describe("signup page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.signUp.email.mockResolvedValue({ data: null, error: null });
  });

  it("shows a short-password error", async () => {
    await renderRoute("/signup");
    fireEvent.change(screen.getByPlaceholderText("昵称"), { target: { value: "Alice" } });
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "alice@test.dev" },
    });
    fireEvent.change(screen.getByPlaceholderText("至少 8 位密码"), {
      target: { value: "short" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "注册" }));
    expect(await screen.findByTestId("password-field-error")).toHaveTextContent("密码至少 8 位");
    expect(auth.signUp.email).not.toHaveBeenCalled();
  });

  it("submits and navigates to /check-email with the email", async () => {
    await renderRoute("/signup");
    fireEvent.change(screen.getByPlaceholderText("昵称"), { target: { value: "Alice" } });
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "alice@test.dev" },
    });
    fireEvent.change(screen.getByPlaceholderText("至少 8 位密码"), {
      target: { value: "alice-password" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "注册" }));
    await vi.waitFor(() =>
      expect(auth.signUp.email).toHaveBeenCalledWith({
        name: "Alice",
        email: "alice@test.dev",
        password: "alice-password",
      }),
    );
    expect(await screen.findByText("验证你的邮箱")).toBeInTheDocument();
  });
});

describe("check-email page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.sendVerificationEmail.mockResolvedValue({ data: null, error: null });
  });

  it("renders the target email and resends via authClient", async () => {
    await renderRoute("/check-email", { email: "alice@test.dev" });
    expect(await screen.findByText("验证你的邮箱")).toBeInTheDocument();
    expect(screen.getByText(/alice@test\.dev/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新发送验证邮件" }));
    await vi.waitFor(() =>
      expect(auth.sendVerificationEmail).toHaveBeenCalledWith({
        email: "alice@test.dev",
        callbackURL: "/verify-email",
      }),
    );
  });
});
