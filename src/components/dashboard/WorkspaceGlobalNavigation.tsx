"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import {
  useDashboardNavigation,
  WorkspaceNavigationButton,
} from "@/components/dashboard/DashboardNavigationContext";
import { isDashboardNavItemActive } from "@/lib/navigation/dashboard-nav-active";
import type { NavGroup } from "@/lib/navigation/build-nav-groups";

const MENU_ITEM_SELECTOR = '[role="menuitem"]';

function isGroupActive(pathname: string, group: NavGroup) {
  return group.items.some((item) =>
    isDashboardNavItemActive(pathname, item.href)
  );
}

export function WorkspaceGlobalNavigation() {
  const navigation = useDashboardNavigation();
  const pathname = navigation?.pathname ?? "";
  const [openGroupKey, setOpenGroupKey] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef(new Map<string, HTMLElement>());
  const menuRefs = useRef(new Map<string, HTMLDivElement>());

  const groups = navigation?.groups ?? [];
  const activeGroupIndex = groups.findIndex((group) =>
    isGroupActive(pathname, group)
  );
  const defaultTabStop = activeGroupIndex >= 0 ? activeGroupIndex : 0;

  const closeMenu = useCallback((restoreFocus = false) => {
    setOpenGroupKey((currentKey) => {
      if (restoreFocus && currentKey) {
        window.requestAnimationFrame(() => {
          triggerRefs.current.get(currentKey)?.focus();
        });
      }
      return null;
    });
  }, []);

  useEffect(() => {
    if (!openGroupKey) return;

    const focusFrame = window.requestAnimationFrame(() => {
      menuRefs.current
        .get(openGroupKey)
        ?.querySelector<HTMLElement>(MENU_ITEM_SELECTOR)
        ?.focus();
    });
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        closeMenu();
      }
    };
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeMenu(true);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [closeMenu, openGroupKey]);

  useEffect(() => {
    setOpenGroupKey(null);
  }, [pathname]);

  if (!navigation || navigation.mode !== "workspace") {
    return null;
  }

  const focusTopLevel = (index: number) => {
    const group = groups[(index + groups.length) % groups.length];
    if (group) {
      triggerRefs.current.get(group.key)?.focus();
    }
  };

  const handleTopLevelKeyDown = (
    event: KeyboardEvent<HTMLElement>,
    index: number,
    group: NavGroup
  ) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      closeMenu();
      focusTopLevel(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      closeMenu();
      focusTopLevel(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      closeMenu();
      focusTopLevel(0);
    } else if (event.key === "End") {
      event.preventDefault();
      closeMenu();
      focusTopLevel(groups.length - 1);
    } else if (event.key === "ArrowDown" && group.items.length > 1) {
      event.preventDefault();
      setOpenGroupKey(group.key);
    }
  };

  const handleSubmenuKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    groupIndex: number
  ) => {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR)
    );
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      items[(currentIndex + direction + items.length) % items.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      items.at(-1)?.focus();
    } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      closeMenu();
      focusTopLevel(groupIndex + (event.key === "ArrowRight" ? 1 : -1));
    } else if (event.key === "Tab") {
      closeMenu();
    }
  };

  return (
    <div ref={containerRef} className="production-ribbon__global-navigation">
      <WorkspaceNavigationButton className="production-ribbon__menu" />

      {groups.length > 0 ? (
        <nav
          className="production-ribbon__global-nav"
          aria-label="Navigation globale"
        >
          <div role="menubar" aria-label="Espaces de travail">
            {groups.map((group, index) => {
              const active = isGroupActive(pathname, group);
              const isOpen = openGroupKey === group.key;
              const topLevelClass = "production-ribbon__global-item";
              const topLevelLabel =
                group.key === "affaires" ? "Affaires" : group.label;

              if (group.items.length === 1) {
                const item = group.items[0];
                return (
                  <Link
                    key={group.key}
                    ref={(element) => {
                      if (element) triggerRefs.current.set(group.key, element);
                    }}
                    href={item.href}
                    role="menuitem"
                    className={topLevelClass}
                    data-active={active ? "true" : undefined}
                    aria-current={active ? "page" : undefined}
                    tabIndex={index === defaultTabStop ? 0 : -1}
                    onKeyDown={(event) =>
                      handleTopLevelKeyDown(event, index, group)
                    }
                  >
                    {topLevelLabel}
                  </Link>
                );
              }

              return (
                <div key={group.key} className="production-ribbon__global-group">
                  <button
                    ref={(element) => {
                      if (element) triggerRefs.current.set(group.key, element);
                    }}
                    type="button"
                    role="menuitem"
                    className={topLevelClass}
                    data-active={active ? "true" : undefined}
                    aria-haspopup="menu"
                    aria-expanded={isOpen}
                    aria-controls={`production-global-menu-${group.key}`}
                    tabIndex={index === defaultTabStop ? 0 : -1}
                    onClick={() =>
                      setOpenGroupKey((current) =>
                        current === group.key ? null : group.key
                      )
                    }
                    onKeyDown={(event) =>
                      handleTopLevelKeyDown(event, index, group)
                    }
                  >
                    {topLevelLabel}
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>

                  {isOpen ? (
                    <div
                      ref={(element) => {
                        if (element) menuRefs.current.set(group.key, element);
                      }}
                      id={`production-global-menu-${group.key}`}
                      role="menu"
                      aria-label={group.label}
                      className="production-ribbon__global-menu"
                      onKeyDown={(event) =>
                        handleSubmenuKeyDown(event, index)
                      }
                    >
                      {group.items.map((item) => {
                        const itemActive = isDashboardNavItemActive(
                          pathname,
                          item.href
                        );
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            role="menuitem"
                            className="production-ribbon__global-menu-item"
                            data-active={itemActive ? "true" : undefined}
                            aria-current={itemActive ? "page" : undefined}
                            onClick={() => closeMenu()}
                          >
                            <span aria-hidden="true">{item.icon}</span>
                            <span>{item.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
