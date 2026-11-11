#!/usr/bin/env bash
set -euo pipefail

# GitHub's Ubuntu image already provides signed official HTTPS fallbacks.
# Avoid its Azure mirror when that endpoint prevents browser dependencies installing.
mirror_list="/etc/apt/apt-mirrors.txt"
azure='^[[:space:]]*https?://azure\.archive\.ubuntu\.com/ubuntu/?([[:space:]]|$)'
public='^[[:space:]]*https://(archive|security)\.ubuntu\.com/ubuntu/?([[:space:]]|$)'

if [[ ! -f "$mirror_list" ]] || ! grep -Eq "$azure" "$mirror_list"; then
  exit 0
fi
if ! grep -Eq "$public" "$mirror_list"; then
  echo "Refusing to remove Azure: no existing official HTTPS Ubuntu fallback." >&2
  exit 1
fi
sed -E -i '/^[[:space:]]*https?:\/\/azure\.archive\.ubuntu\.com\/ubuntu\/?([[:space:]]|$)/d' "$mirror_list"
echo "Using the runner's existing official HTTPS Ubuntu mirrors."
