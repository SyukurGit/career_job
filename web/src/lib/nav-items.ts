import { Briefcase, BookmarkCheck, Radar, Sparkles, FileText, Settings } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

// Single source of truth for the app's primary destinations — shared by the
// desktop sidebar and the mobile nav so they can never drift.
export type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  chip?: string;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/loker", label: "Katalog Loker", icon: Briefcase },
  { href: "/loker/tersimpan", label: "Loker Tersimpan", icon: BookmarkCheck },
  { href: "/scanner", label: "Pusat Scan", icon: Radar },
  { href: "/ai-tester", label: "Uji Model AI", icon: Sparkles },
  { href: "/cv", label: "Profil & CV", icon: FileText },
  { href: "/config", label: "Pengaturan", icon: Settings },
];

export function visibleNavItems(_followupsEnabled?: boolean): NavItem[] {
  return NAV_ITEMS;
}

export function isActivePath(href: string, pathname: string): boolean {
  if (href === "/loker") {
    return pathname === "/loker" || (pathname.startsWith("/loker/") && !pathname.startsWith("/loker/tersimpan"));
  }
  return pathname.startsWith(href);
}
