"use client";

import { ChevronDown } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { WalletConnect } from "@/components/auth/wallet-connect";
import type { AuthPermissions } from "@/lib/auth/types";
import { cn } from "@/lib/utils";

type AppHeaderSession = {
  address: `0x${string}` | null;
  authenticated: boolean;
  canUseMemberView?: boolean;
  chainId: number | null;
  permissions: AuthPermissions | null;
  viewMode?: "admin" | "member";
};

type AppHeaderProps = {
  initialSession: AppHeaderSession;
};

type NavLink = {
  href: string;
  label: string;
};

const accountingLinks: NavLink[] = [
  { href: "/raids", label: "Raids" },
  { href: "/rips", label: "RIPs" },
  { href: "/admin/providers", label: "Providers" },
  { href: "/admin/treasury-accounts", label: "Accounts" },
];

const daoLinks: NavLink[] = [
  { href: "/proposals", label: "Proposals" },
  { href: "/membership", label: "Membership" },
];

function isActivePath(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavItem({ children, href }: { children: ReactNode; href: string }) {
  const pathname = usePathname();
  const active = isActivePath(pathname, href);

  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-9 shrink-0 items-center justify-center rounded-md px-3 text-sm font-medium transition-all",
        active
          ? "bg-scroll-100 text-moloch-800 shadow-sm"
          : "text-scroll-200 hover:bg-scroll-100/10 hover:text-scroll-100",
      )}
    >
      {children}
    </Link>
  );
}

function NavGroup({
  isOpen,
  label,
  links,
  onOpenChange,
}: {
  isOpen: boolean;
  label: string;
  links: NavLink[];
  onOpenChange: (open: boolean) => void;
}) {
  const pathname = usePathname();
  const active = links.some((link) => isActivePath(pathname, link.href));

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => onOpenChange(!isOpen)}
        className={cn(
          "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium transition-all",
          active
            ? "bg-scroll-100 text-moloch-800 shadow-sm"
            : "text-scroll-200 hover:bg-scroll-100/10 hover:text-scroll-100",
        )}
      >
        {label}
        <ChevronDown
          className={cn("size-3.5 transition-transform", isOpen && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {isOpen ? (
        <div className="absolute left-0 top-11 z-30 grid min-w-52 gap-1 overflow-hidden rounded-lg border border-scroll-300/25 bg-moloch-800 p-1 shadow-xl shadow-black/35">
          {links.map((link) => {
            const linkActive = isActivePath(pathname, link.href);

            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => onOpenChange(false)}
                className={cn(
                  "flex h-9 items-center rounded-md px-3 text-sm font-medium transition-all",
                  linkActive
                    ? "bg-scroll-100 text-moloch-800"
                    : "text-scroll-100 hover:bg-scroll-100/10",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function AppHeader({ initialSession }: AppHeaderProps) {
  const navRef = useRef<HTMLElement | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (
        navRef.current &&
        event.target instanceof Node &&
        !navRef.current.contains(event.target)
      ) {
        setOpenGroup(null);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  return (
    <header className="border-b border-moloch-800 bg-moloch-800 text-scroll-100">
      <div className="container-custom grid min-h-18 gap-3 py-3 xl:grid-cols-[auto_1fr] xl:items-center">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-3 rounded-md outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-scroll-300"
          aria-label="RaidGuild Accounting dashboard"
        >
          <Image
            src="/raidguild-full-logo.svg"
            alt="RaidGuild"
            width={120}
            height={32}
            className="h-8 w-auto shrink-0"
            style={{ width: "auto" }}
          />
          <div className="min-w-0">
            <p className="type-label-sm text-scroll-200">RaidGuild</p>
            <p className="text-base font-semibold leading-none">Accounting</p>
          </div>
        </Link>

        <div className="flex min-w-0 flex-wrap items-center gap-3 xl:justify-end">
          {initialSession.permissions?.canAccess ? (
            <nav
              ref={navRef}
              className="flex min-w-0 flex-wrap items-center gap-1 rounded-lg border border-scroll-300/20 bg-moloch-900/35 p-1 shadow-inner shadow-black/10"
              aria-label="Accounting sections"
            >
              <NavItem href="/">Dashboard</NavItem>
              <NavItem href="/admin/quarters">Quarters</NavItem>
              <NavGroup
                isOpen={openGroup === "accounting"}
                label="Accounting"
                links={accountingLinks}
                onOpenChange={(open) =>
                  setOpenGroup(open ? "accounting" : null)
                }
              />
              <NavGroup
                isOpen={openGroup === "dao"}
                label="DAO"
                links={daoLinks}
                onOpenChange={(open) => setOpenGroup(open ? "dao" : null)}
              />
            </nav>
          ) : null}
          <WalletConnect initialSession={initialSession} />
        </div>
      </div>
    </header>
  );
}
