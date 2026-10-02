/**
 * Tela de login — o único método é "Entrar com o Google" (D-Auth-1).
 *
 * Não há login por senha nem outro provedor, e não deve haver: a allowlist de
 * 4 e-mails pressupõe identidade verificada pelo Google.
 *
 * O script do Google Identity Services é carregado sob demanda, só aqui — não
 * no `__root.tsx`. Quem já tem sessão nunca o baixa.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api.ts";

const GSI_SRC = "https://accounts.google.com/gsi/client";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: Record<string, unknown>) => void;
          renderButton: (
            el: HTMLElement,
            options: Record<string, unknown>,
          ) => void;
        };
      };
    };
  }
}

function loadGsi(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GSI_SRC}"]`,
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("falha ao carregar o Google")),
      );
      return;
    }

    const script = document.createElement("script");
    script.src = GSI_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("falha ao carregar o Google"));
    document.head.appendChild(script);
  });
}

export function GoogleSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  // ⚠️ Resolvido em BUILD, não em runtime — o preset injeta via `define:` e o
  // valor fica inlinado no bundle. Trocar na Vercel exige **rebuild**.
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

  const handleCredential = useCallback(
    async (credential: string) => {
      try {
        await api.post("/auth/google", { credential });
        onSignedIn();
      } catch (cause) {
        // O backend distingue 401 (token inválido) de 403 (fora da allowlist)
        // e manda o `detail` pronto. Exibir a mensagem dele evita inventar
        // texto que discorde da regra do servidor.
        setError(
          cause instanceof Error ? cause.message : "Não foi possível entrar.",
        );
      }
    },
    [onSignedIn],
  );

  useEffect(() => {
    if (!clientId) {
      setError(
        "VITE_GOOGLE_CLIENT_ID não está configurada — o login do Google não pode ser exibido.",
      );
      return;
    }

    let cancelled = false;

    loadGsi()
      .then(() => {
        if (cancelled || !buttonRef.current || !window.google) return;

        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response: { credential?: string }) => {
            if (!response.credential) {
              setError("O Google não devolveu uma credencial.");
              return;
            }
            void handleCredential(response.credential);
          },
        });

        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: "outline",
          size: "large",
          text: "signin_with",
          locale: "pt-BR",
        });
      })
      .catch(() => {
        if (!cancelled)
          setError("Não foi possível carregar o login do Google.");
      });

    return () => {
      cancelled = true;
    };
  }, [clientId, handleCredential]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Fisco
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Organizador financeiro pessoal. O acesso é restrito.
        </p>

        <div className="mt-8 flex justify-center" ref={buttonRef} />

        {error && (
          <p className="mt-6 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
