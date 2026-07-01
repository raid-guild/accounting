"use client";

import { ChevronDown, Menu, X } from "lucide-react";
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
  canUseRolePreview?: boolean;
  chainId: number | null;
  permissions: AuthPermissions | null;
  viewMode?: "admin" | "cleric" | "member";
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

const primaryLinks: NavLink[] = [
  { href: "/", label: "Dashboard" },
  { href: "/reports", label: "Reports" },
  { href: "/admin/quarters", label: "Quarters" },
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

function MobileNavSection({
  links,
  onNavigate,
  title,
}: {
  links: NavLink[];
  onNavigate: () => void;
  title: string;
}) {
  const pathname = usePathname();

  return (
    <section>
      <h2 className="type-label-sm text-scroll-300">{title}</h2>
      <div className="mt-2 grid gap-1">
        {links.map((link) => {
          const active = isActivePath(pathname, link.href);

          return (
            <Link
              key={link.href}
              href={link.href}
              onClick={onNavigate}
              className={cn(
                "flex h-11 items-center rounded-lg px-3 text-sm font-medium transition-all",
                active
                  ? "bg-scroll-100 text-moloch-800 shadow-sm"
                  : "text-scroll-100 hover:bg-scroll-100/10",
              )}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export function AppHeader({ initialSession }: AppHeaderProps) {
  const canAccess = Boolean(initialSession.permissions?.canAccess);
  const navRef = useRef<HTMLElement | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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

  useEffect(() => {
    if (!mobileMenuOpen) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMobileMenuOpen(false);
      }
    }

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileMenuOpen]);

  return (
    <>
      <header
        className={cn(
          "border-b border-moloch-800 bg-moloch-800 text-scroll-100",
          mobileMenuOpen && "pointer-events-none sm:pointer-events-auto",
        )}
      >
        <div className="container-custom relative grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 py-3 xl:grid-cols-[auto_1fr] xl:items-center">
          <Link
            href="/"
            className="flex w-fit min-w-0 items-center gap-3 rounded-md pr-14 outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-scroll-300 sm:pr-0"
            aria-label="RaidGuild Accounting dashboard"
          >
            <span className="relative block h-8 w-[120px] shrink-0">
              <Image
                src="/raidguild-full-logo.svg"
                alt="RaidGuild"
                fill
                priority
                sizes="120px"
                className="object-contain"
              />
            </span>
            <div className="min-w-0">
              <p className="type-label-sm text-scroll-200">RaidGuild</p>
              <p className="text-base font-semibold leading-none">Accounting</p>
            </div>
          </Link>

          {canAccess ? (
            <button
              type="button"
              aria-controls="mobile-accounting-menu"
              aria-expanded={mobileMenuOpen}
              aria-label="Menu"
              onClick={() => setMobileMenuOpen(true)}
              className="absolute right-3 top-3 inline-flex size-10 cursor-pointer items-center justify-center rounded-lg border border-scroll-300/25 bg-moloch-900/35 text-scroll-100 transition-all hover:bg-scroll-100/10 focus-visible:ring-2 focus-visible:ring-scroll-300 sm:hidden"
            >
              <Menu className="size-4" aria-hidden="true" />
              <span className="sr-only">Menu</span>
            </button>
          ) : null}

          <div className="col-span-2 grid min-w-0 justify-items-start gap-3 sm:col-span-1 sm:justify-items-end xl:flex xl:items-center xl:justify-end">
            {canAccess ? (
              <>
                <nav
                  ref={navRef}
                  className="hidden min-w-0 flex-wrap items-center gap-1 rounded-lg border border-scroll-300/20 bg-moloch-900/35 p-1 shadow-inner shadow-black/10 sm:flex"
                  aria-label="Accounting sections"
                >
                  {primaryLinks.map((link) => (
                    <NavItem key={link.href} href={link.href}>
                      {link.label}
                    </NavItem>
                  ))}
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
              </>
            ) : null}
            <div className="col-span-2 min-w-0 justify-self-start sm:justify-self-end xl:col-span-1 xl:justify-self-auto">
              <WalletConnect initialSession={initialSession} />
            </div>
          </div>
        </div>
      </header>

      {canAccess && mobileMenuOpen ? (
        <div
          className="fixed inset-0 z-50 sm:hidden"
          onClick={() => setMobileMenuOpen(false)}
          role="presentation"
        >
          <div
            aria-hidden="true"
            className="drawer-backdrop-enter pointer-events-none absolute inset-0 bg-moloch-800/70 backdrop-blur-sm"
          />
          <aside
            id="mobile-accounting-menu"
            className="drawer-panel-enter absolute inset-y-0 right-0 grid w-[min(21rem,calc(100vw-2rem))] grid-rows-[auto_1fr] overflow-y-auto border-l border-scroll-300/20 bg-moloch-800 p-4 text-scroll-100 shadow-2xl shadow-black/40"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="type-label-sm text-scroll-300">RaidGuild</p>
                <p className="text-lg font-semibold">Accounting</p>
              </div>
              <div className="size-10" aria-hidden="true" />
            </div>

            <nav
              aria-label="Accounting sections"
              className="mt-8 grid content-start gap-7"
            >
              <MobileNavSection
                links={primaryLinks}
                onNavigate={() => setMobileMenuOpen(false)}
                title="Main"
              />
              <MobileNavSection
                links={accountingLinks}
                onNavigate={() => setMobileMenuOpen(false)}
                title="Accounting"
              />
              <MobileNavSection
                links={daoLinks}
                onNavigate={() => setMobileMenuOpen(false)}
                title="DAO"
              />
            </nav>
          </aside>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMobileMenuOpen(false)}
            className="drawer-panel-enter fixed right-4 top-4 z-[60] inline-flex size-10 cursor-pointer items-center justify-center rounded-lg border border-scroll-300/25 bg-moloch-900/80 text-scroll-100 shadow-xl shadow-black/30 transition-all hover:bg-scroll-100/10 focus-visible:ring-2 focus-visible:ring-scroll-300"
            style={{ pointerEvents: "auto", zIndex: 1000 }}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </>
  );
}
