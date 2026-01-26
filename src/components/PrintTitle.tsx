"use client";

import { useEffect } from "react";

type PrintTitleProps = {
  title: string;
};

export function PrintTitle({ title }: PrintTitleProps) {
  useEffect(() => {
    if (!title) return;
    document.title = title;
  }, [title]);

  return null;
}
