import type { CSSProperties } from "react";

type FileTypeIconProps = {
  mimeType: string;
  filename?: string;
  className?: string;
};

type IconProps = {
  className?: string;
  style?: CSSProperties;
};

function PDFIcon({ className, style }: IconProps) {
  return (
    <svg
      className={className}
      style={style}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M9 15v-2h1.5a1.5 1.5 0 0 1 0 3H9v2" />
      <path d="M15 13h1.5a1.5 1.5 0 0 1 0 3H15v2" />
    </svg>
  );
}

function ImageIcon({ className, style }: IconProps) {
  return (
    <svg
      className={className}
      style={style}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

function SpreadsheetIcon({ className, style }: IconProps) {
  return (
    <svg
      className={className}
      style={style}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="16" y2="17" />
      <line x1="10" y1="9" x2="10" y2="21" />
    </svg>
  );
}

function EmailIcon({ className, style }: IconProps) {
  return (
    <svg
      className={className}
      style={style}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M22 6l-10 7L2 6" />
    </svg>
  );
}

function DefaultFileIcon({ className, style }: IconProps) {
  return (
    <svg
      className={className}
      style={style}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

const FILE_TYPE_CONFIG: Record<
  string,
  { icon: React.FC<IconProps>; color: string; label: string }
> = {
  "application/pdf": {
    icon: PDFIcon,
    color: "#ef4444",
    label: "PDF",
  },
  "image/jpeg": {
    icon: ImageIcon,
    color: "#3b82f6",
    label: "Image",
  },
  "image/png": {
    icon: ImageIcon,
    color: "#3b82f6",
    label: "Image",
  },
  "image/gif": {
    icon: ImageIcon,
    color: "#3b82f6",
    label: "Image",
  },
  "image/webp": {
    icon: ImageIcon,
    color: "#3b82f6",
    label: "Image",
  },
  "application/vnd.ms-excel": {
    icon: SpreadsheetIcon,
    color: "#22c55e",
    label: "Excel",
  },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    icon: SpreadsheetIcon,
    color: "#22c55e",
    label: "Excel",
  },
  "text/csv": {
    icon: SpreadsheetIcon,
    color: "#22c55e",
    label: "CSV",
  },
  "message/rfc822": {
    icon: EmailIcon,
    color: "#8b5cf6",
    label: "Email",
  },
  "application/vnd.ms-outlook": {
    icon: EmailIcon,
    color: "#8b5cf6",
    label: "Email",
  },
};

const EXTENSION_CONFIG: Record<
  string,
  { icon: React.FC<IconProps>; color: string; label: string }
> = {
  ".eml": {
    icon: EmailIcon,
    color: "#8b5cf6",
    label: "Email",
  },
  ".msg": {
    icon: EmailIcon,
    color: "#8b5cf6",
    label: "Email",
  },
  ".pdf": {
    icon: PDFIcon,
    color: "#ef4444",
    label: "PDF",
  },
  ".xls": {
    icon: SpreadsheetIcon,
    color: "#22c55e",
    label: "Excel",
  },
  ".xlsx": {
    icon: SpreadsheetIcon,
    color: "#22c55e",
    label: "Excel",
  },
  ".csv": {
    icon: SpreadsheetIcon,
    color: "#22c55e",
    label: "CSV",
  },
};

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) return "";
  return filename.slice(lastDot).toLowerCase();
}

function getFileTypeConfig(mimeType: string, filename?: string) {
  if (FILE_TYPE_CONFIG[mimeType]) {
    return FILE_TYPE_CONFIG[mimeType];
  }

  if (mimeType.startsWith("image/")) {
    return {
      icon: ImageIcon,
      color: "#3b82f6",
      label: "Image",
    };
  }

  // Fallback to extension-based detection
  if (filename) {
    const ext = getExtension(filename);
    if (EXTENSION_CONFIG[ext]) {
      return EXTENSION_CONFIG[ext];
    }
  }

  return {
    icon: DefaultFileIcon,
    color: "#64748b",
    label: "Fichier",
  };
}

export function FileTypeIcon({ mimeType, filename, className = "" }: FileTypeIconProps) {
  const config = getFileTypeConfig(mimeType, filename);
  const IconComponent = config.icon;

  // Check if custom size classes are provided
  const hasCustomSize = className.includes("!h-") || className.includes("!w-");
  const sizeClasses = hasCustomSize ? "" : "h-10 w-10";
  const iconSizeClasses = hasCustomSize ? "h-6 w-6" : "h-5 w-5";

  return (
    <div
      className={`flex flex-shrink-0 items-center justify-center ${sizeClasses} ${className}`}
      style={{ backgroundColor: `${config.color}12` }}
      title={config.label}
    >
      <IconComponent
        className={iconSizeClasses}
        style={{ color: config.color }}
      />
    </div>
  );
}

export function getFileTypeLabel(mimeType: string, filename?: string): string {
  return getFileTypeConfig(mimeType, filename).label;
}
