#!/usr/bin/env bash

set -euo pipefail

NODE_MAJOR="${NODE_MAJOR:-22}"
MSL_DEPLOY_USER="${MSL_DEPLOY_USER:-${SUDO_USER:-$(id -un)}}"
MSL_APP_DIR="${MSL_APP_DIR:-/home/${MSL_DEPLOY_USER}/code/Msl}"
MSL_DATA_DIR="${MSL_DATA_DIR:-/home/${MSL_DEPLOY_USER}/msl-data}"
MSL_LOG_DIR="${MSL_LOG_DIR:-${MSL_DATA_DIR}/logs}"

log() {
  printf '\n==> %s\n' "$1"
}

require_ubuntu() {
  if [[ ! -r /etc/os-release ]]; then
    printf 'Cannot detect OS. This bootstrap supports Ubuntu only.\n' >&2
    exit 1
  fi

  # shellcheck source=/dev/null
  source /etc/os-release

  if [[ "${ID:-}" != "ubuntu" ]]; then
    printf 'Unsupported OS: %s. This bootstrap supports Ubuntu only.\n' "${ID:-unknown}" >&2
    exit 1
  fi
}

as_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
    return
  fi

  if ! command -v sudo >/dev/null 2>&1; then
    printf 'This command needs root privileges and sudo is not installed.\n' >&2
    exit 1
  fi

  sudo "$@"
}

ensure_user_exists() {
  if [[ "$MSL_DEPLOY_USER" == "root" ]]; then
    printf 'Refusing to configure MSL for the root user.\n' >&2
    printf 'Create a non-root deploy user first, then run with MSL_DEPLOY_USER=<user>.\n' >&2
    exit 1
  fi

  if ! id "$MSL_DEPLOY_USER" >/dev/null 2>&1; then
    printf 'Deploy user does not exist: %s\n' "$MSL_DEPLOY_USER" >&2
    printf 'Create it first or set MSL_DEPLOY_USER to an existing non-root user.\n' >&2
    exit 1
  fi
}

require_user_owned_path() {
  local label="$1"
  local path="$2"
  local home_dir="/home/${MSL_DEPLOY_USER}"

  if [[ -z "$path" || "$path" == "/" || "$path" == "$home_dir" ]]; then
    printf 'Unsafe %s path: %s\n' "$label" "${path:-<empty>}" >&2
    exit 1
  fi

  case "$path" in
    "$home_dir"/*) ;;
    *)
      printf 'Unsafe %s path: %s\n' "$label" "$path" >&2
      printf 'Expected a path under %s/.\n' "$home_dir" >&2
      exit 1
      ;;
  esac
}

validate_runtime_paths() {
  require_user_owned_path 'app directory' "$MSL_APP_DIR"
  require_user_owned_path 'data directory' "$MSL_DATA_DIR"
  require_user_owned_path 'log directory' "$MSL_LOG_DIR"
}

install_system_packages() {
  log 'Installing base system packages'
  as_root apt-get update
  as_root apt-get install -y ca-certificates curl gnupg git build-essential sqlite3 nginx ufw
}

install_node() {
  if command -v node >/dev/null 2>&1; then
    local current_major
    current_major="$(node -p 'process.versions.node.split(".")[0]')"
    if [[ "$current_major" -ge "$NODE_MAJOR" ]]; then
      log "Node.js $(node --version) already satisfies Node ${NODE_MAJOR}+"
      return
    fi
  fi

  log "Installing Node.js ${NODE_MAJOR}.x from NodeSource"
  local setup_script
  setup_script="$(mktemp)"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" -o "$setup_script"
  as_root bash "$setup_script"
  rm -f "$setup_script"
  as_root apt-get install -y nodejs
}

install_pm2() {
  if command -v pm2 >/dev/null 2>&1; then
    log "PM2 $(pm2 --version) already installed"
    return
  fi

  log 'Installing PM2 globally'
  as_root npm install -g pm2
}

create_runtime_dirs() {
  log 'Creating MSL runtime directories'
  as_root mkdir -p "$MSL_APP_DIR" "$MSL_DATA_DIR" "$MSL_LOG_DIR"
  as_root chown "$MSL_DEPLOY_USER:$MSL_DEPLOY_USER" "$MSL_APP_DIR" "$MSL_DATA_DIR" "$MSL_LOG_DIR"
  as_root chmod 700 "$MSL_DATA_DIR"
  as_root chmod 750 "$MSL_LOG_DIR"
}

print_next_steps() {
  cat <<EOF

Bootstrap complete.

Installed or verified:
- Git, build tools, SQLite, Nginx, UFW
- Node.js $(node --version) and npm $(npm --version)
- PM2 $(pm2 --version)
- Runtime directories:
  - App:  ${MSL_APP_DIR}
  - Data: ${MSL_DATA_DIR}
  - Logs: ${MSL_LOG_DIR}

Next manual steps:
1. Clone the repository into ${MSL_APP_DIR} as ${MSL_DEPLOY_USER}.
2. Create ${MSL_APP_DIR}/.env.local from .env.example and paste secrets only on the VPS.
3. Copy SQLite database files into ${MSL_DATA_DIR} using a secure channel.
4. Run: npm ci
5. Run: npm run build
6. Run: npm run pm2:start
7. Run: pm2 save
8. Run the command printed by: pm2 startup systemd -u ${MSL_DEPLOY_USER} --hp /home/${MSL_DEPLOY_USER}
9. Configure Nginx, TLS, and Cloudflare DNS for plasticov.cl.

No secrets were created, read, or printed by this script.
EOF
}

main() {
  require_ubuntu
  ensure_user_exists
  validate_runtime_paths
  install_system_packages
  install_node
  install_pm2
  create_runtime_dirs
  print_next_steps
}

main "$@"
