"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

const ERROR_MESSAGES: Record<string, string> = {
  not_invited:
    "Your Google account is not on the invite list. Ask an admin to add you.",
  google_error: "Google sign-in was cancelled or failed. Please try again.",
  invalid_state: "Session expired. Please try signing in again.",
  token_exchange_failed: "Authentication failed. Please try again.",
  userinfo_failed: "Could not retrieve your Google account info. Please try again.",
  no_email: "No email address found on your Google account.",
  missing_params: "Invalid callback. Please try signing in again.",
  unexpected: "Something went wrong. Please try again.",
};

function LoginForm() {
  const params = useSearchParams();
  const errorCode = params.get("error");
  const errorMessage = errorCode ? ERROR_MESSAGES[errorCode] || ERROR_MESSAGES.unexpected : null;

  return (
    <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-200/60 p-6 shadow-xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Sign in</h1>
      <p className="text-sm text-gray-500 mb-6">Slideshow Creator</p>

      {errorMessage && (
        <div className="text-sm text-red-500 mb-4 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {errorMessage}
        </div>
      )}

      <a
        href="/api/auth/login"
        className="flex items-center justify-center gap-3 w-full bg-white text-gray-900 font-medium rounded-xl py-2.5 text-sm border border-gray-200 hover:bg-gray-50 transition-colors shadow-sm"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24">
          <path
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
            fill="#4285F4"
          />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            fill="#34A853"
          />
          <path
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            fill="#FBBC05"
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            fill="#EA4335"
          />
        </svg>
        Sign in with Google
      </a>

      <p className="text-[11px] text-gray-400 mt-4 text-center">
        Invite-only. Contact an admin for access.
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f5f7] px-4">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
