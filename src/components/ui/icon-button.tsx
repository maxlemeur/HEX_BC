"use client"

import * as React from "react"

import { Button, type ButtonProps } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

type IconButtonProps = Omit<ButtonProps, "children" | "leftIcon" | "rightIcon" | "size"> & {
  /** Accessible name, also shown as tooltip (replaces `title=`, which touch and keyboard users never see). */
  label: string
  icon: React.ReactNode
  size?: "icon-xs" | "icon-sm" | "icon" | "icon-lg"
  tooltipSide?: "top" | "bottom" | "left" | "right"
}

function IconButton({ label, icon, size = "icon-sm", variant = "ghost", tooltipSide = "top", ...props }: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant={variant} size={size} aria-label={label} {...props} />}>
        {icon}
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>{label}</TooltipContent>
    </Tooltip>
  )
}

export { IconButton }
