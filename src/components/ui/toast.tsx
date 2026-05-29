"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type Toast = {
  id: number;
  message: string;
  state: "entering" | "leaving";
};

type ToastContextValue = {
  showToast: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string) => {
    const id = Date.now();
    setToasts((currentToasts) => [
      ...currentToasts,
      { id, message, state: "entering" },
    ]);
    window.setTimeout(() => {
      setToasts((currentToasts) =>
        currentToasts.map((toast) =>
          toast.id === id ? { ...toast, state: "leaving" } : toast,
        ),
      );
    }, 3000);
    window.setTimeout(() => {
      setToasts((currentToasts) =>
        currentToasts.filter((toast) => toast.id !== id),
      );
    }, 3250);
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="fixed inset-x-4 bottom-4 z-50 flex flex-col-reverse items-center gap-2 sm:inset-x-auto sm:right-4 sm:items-end"
        aria-live="polite"
        aria-atomic="true"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            data-state={toast.state}
            className="toast-enter w-full max-w-80 rounded-md border border-border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg data-[state=leaving]:animate-toast-out sm:w-80"
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }

  return context;
}
