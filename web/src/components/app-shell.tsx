"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { BrandMark } from "@/components/brand-mark";
import { MobileNav } from "@/components/mobile-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { BackToTop } from "@/components/back-to-top";
import { JobsProvider } from "@/components/jobs/job-store";
import { WorkerPills } from "@/components/jobs/worker-pills";
import { NAV_ITEMS, isActivePath } from "@/lib/nav-items";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <JobsProvider>
      <a
        href="#main-content"
        className="sr-only rounded-md bg-brand text-sm font-medium text-brand-foreground focus:not-sr-only focus:fixed focus:px-3 focus:py-2 focus:left-3 focus:top-3 focus:z-[100] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
      >
        Lewati ke konten utama
      </a>
      <MobileNav />
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden print:hidden h-screen w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface/40 p-4 md:flex">
          <Link href="/loker" className="mb-6 flex items-center gap-2.5 rounded-lg px-1.5 py-1 transition-opacity hover:opacity-90">
            <BrandMark size={32} />
            <span className="flex items-baseline gap-1 font-display text-[21px] font-bold tracking-tight text-landing whitespace-nowrap">
              <span>dreamkur</span>
              <span className="font-mono text-[15px] font-semibold text-brand-text">-job</span>
            </span>
          </Link>

          <nav aria-label="Navigasi utama" className="flex flex-col gap-1">
            {NAV_ITEMS.map(({ href, label, icon: Icon, chip }) => {
              const active = isActivePath(href, pathname);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                    active
                      ? "border border-brand/30 bg-brand-soft text-brand-text shadow-xs"
                      : "border border-transparent text-muted hover:bg-surface-hover hover:text-foreground",
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span>{label}</span>
                  {chip && (
                    <span className="ml-auto rounded-full border border-brand/30 bg-brand-soft px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-brand-text">
                      {chip}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          <WorkerPills />

          <div className="mt-auto space-y-2 border-t border-border/80 pt-3">
            <div className="px-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-faint">Tampilan</span>
            </div>
            <ThemeToggle showLabel />
          </div>
        </aside>
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-x-hidden focus:outline-none">
          {children}
        </main>
        <div className="print:hidden">
          <BackToTop />
        </div>
      </div>
    </JobsProvider>
  );
}
