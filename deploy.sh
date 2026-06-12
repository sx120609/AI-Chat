#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="${APP_NAME:-team-ai-gateway}"
APP_PORT="${APP_PORT:-20131}"
APP_HOST="${APP_HOST:-0.0.0.0}"
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
APP_USER="${APP_USER:-${SUDO_USER:-$(id -un)}}"
APP_GROUP="${APP_GROUP:-$(id -gn "$APP_USER" 2>/dev/null || id -gn)}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
SERVICE_NAME="${SERVICE_NAME:-$APP_NAME}"
NODE_MAJOR="${NODE_MAJOR:-22}"
SKIP_LOCAL_POSTGRES="${SKIP_LOCAL_POSTGRES:-false}"
INSTALL_DOCKER="${INSTALL_DOCKER:-false}"
SETUP_NGINX="${SETUP_NGINX:-false}"
DOMAIN="${DOMAIN:-}"

GENERATED_ADMIN_PASSWORD=""
ENV_CREATED="false"

log() {
  printf '\033[1;34m[deploy]\033[0m %s\n' "$*"
}

warn() {
  printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2
}

fail() {
  printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2
  exit 1
}

as_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

as_root_preserve_env() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    sudo -E "$@"
  fi
}

as_user() {
  local user="$1"
  shift

  if [[ "$(id -un)" == "$user" ]]; then
    "$@"
  elif [[ "$(id -u)" -eq 0 ]]; then
    runuser -u "$user" -- "$@"
  else
    sudo -H -u "$user" "$@"
  fi
}

require_apt() {
  command -v apt-get >/dev/null 2>&1 || fail "This script currently supports Debian/Ubuntu with apt-get."
}

random_hex() {
  openssl rand -hex "${1:-32}"
}

random_alnum() {
  local length value
  length="${1:-24}"
  value="$(openssl rand -hex 64)"
  printf '%s' "${value:0:length}"
}

shell_quote() {
  printf '%q' "$1"
}

systemd_escape_path() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/ /\\x20/g'
}

run_as_app_user() {
  local quoted_dir quoted_cmd

  quoted_dir="$(shell_quote "$APP_DIR")"
  quoted_cmd=""
  for arg in "$@"; do
    quoted_cmd+=" $(shell_quote "$arg")"
  done

  if [[ "$(id -un)" == "$APP_USER" ]]; then
    (cd "$APP_DIR" && "$@")
  else
    as_user "$APP_USER" bash -lc "cd $quoted_dir &&$quoted_cmd"
  fi
}

load_env_file() {
  if [[ -f "$ENV_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
  fi
}

append_env_line_if_missing() {
  local key="$1"
  local value="$2"

  if [[ ! -f "$ENV_FILE" ]] || ! grep -Eq "^${key}=" "$ENV_FILE"; then
    printf '%s="%s"\n' "$key" "$value" >>"$ENV_FILE"
  fi
}

parse_database_url() {
  PARSED_DB_USER=""
  PARSED_DB_PASSWORD=""
  PARSED_DB_HOST=""
  PARSED_DB_NAME=""

  local url="${DATABASE_URL:-}"
  if [[ "$url" =~ ^postgres(ql)?://([^:/?#]+):([^@/?#]*)@([^/:?#]+)(:([0-9]+))?/([^?]+) ]]; then
    PARSED_DB_USER="${BASH_REMATCH[2]}"
    PARSED_DB_PASSWORD="${BASH_REMATCH[3]}"
    PARSED_DB_HOST="${BASH_REMATCH[4]}"
    PARSED_DB_NAME="${BASH_REMATCH[7]}"
  fi
}

set_db_defaults() {
  parse_database_url
  DB_NAME="${DB_NAME:-${PARSED_DB_NAME:-team_ai_gateway}}"
  DB_USER="${DB_USER:-${PARSED_DB_USER:-team_ai_gateway}}"
  DB_PASSWORD="${DB_PASSWORD:-${PARSED_DB_PASSWORD:-}}"
  DB_HOST="${DB_HOST:-${PARSED_DB_HOST:-127.0.0.1}}"

  if [[ -z "$DB_PASSWORD" ]]; then
    DB_PASSWORD="$(random_alnum 28)"
  fi
}

validate_pg_identifier() {
  local value="$1"
  local label="$2"

  [[ "$value" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] ||
    fail "$label must contain only letters, numbers, and underscores, and cannot start with a number."
}

sql_escape() {
  printf "%s" "$1" | sed "s/'/''/g"
}

install_system_packages() {
  require_apt
  log "Installing system packages..."
  as_root apt-get update
  as_root apt-get install -y ca-certificates curl git build-essential openssl postgresql postgresql-contrib

  local current_major="0"
  if command -v node >/dev/null 2>&1; then
    current_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  fi

  if [[ "$current_major" -lt 20 ]]; then
    log "Installing Node.js ${NODE_MAJOR}.x..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | as_root_preserve_env bash -
    as_root apt-get install -y nodejs
  fi

  if [[ "$INSTALL_DOCKER" == "true" ]]; then
    log "Installing Docker runtime for optional code interpreter sandbox..."
    as_root apt-get install -y docker.io
    as_root systemctl enable --now docker
    as_root usermod -aG docker "$APP_USER" || true
  fi
}

redact_redis_url() {
  printf '%s' "$1" | sed -E 's#^(rediss?://)([^/@]*@)#\1***@#'
}

redis_url_host() {
  local url="$1"
  local authority host

  if [[ ! "$url" =~ ^rediss?://([^/]+) ]]; then
    printf '127.0.0.1'
    return
  fi

  authority="${BASH_REMATCH[1]}"
  authority="${authority##*@}"

  if [[ "$authority" == \[*\]* ]]; then
    host="${authority#\[}"
    host="${host%%\]*}"
  else
    host="${authority%%:*}"
  fi

  printf '%s' "$host"
}

is_local_redis_url() {
  local host
  host="$(redis_url_host "$1")"

  case "$host" in
    ""|localhost|127.*|0.0.0.0|::1)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

redis_ping() {
  local redis_url="$1"

  command -v redis-cli >/dev/null 2>&1 || return 1
  timeout 3 redis-cli -u "$redis_url" ping 2>/dev/null | tr -d '\r' | grep -qx PONG
}

ensure_redis() {
  require_apt

  load_env_file

  if [[ "${CACHE_ENABLED:-true}" == "false" ]]; then
    log "Skipping Redis setup because CACHE_ENABLED=false."
    return
  fi

  local redis_url redis_url_for_log
  redis_url="${REDIS_URL:-redis://127.0.0.1:6379}"
  redis_url_for_log="$(redact_redis_url "$redis_url")"

  if redis_ping "$redis_url"; then
    log "Redis is already reachable at $redis_url_for_log."
    return
  fi

  if ! is_local_redis_url "$redis_url"; then
    warn "Redis is not reachable at $redis_url_for_log. Skipping local redis-server management because REDIS_URL is not local."
    return
  fi

  if ! command -v redis-server >/dev/null 2>&1; then
    log "Installing Redis cache..."
    as_root apt-get update
    as_root apt-get install -y redis-server
  fi

  log "Ensuring local Redis service is running..."
  if as_root systemctl enable --now redis-server; then
    if redis_ping "$redis_url"; then
      return
    fi

    warn "redis-server.service started, but Redis did not answer PING at $redis_url_for_log."
    return
  fi

  warn "redis-server.service could not be started. Continuing because Redis is only used as a cache."
  warn "If your server already has a panel-managed Redis, set REDIS_URL to that instance or set CACHE_ENABLED=false."
  as_root systemctl --no-pager --full status redis-server || true
}

ensure_env_file() {
  mkdir -p "$(dirname "$ENV_FILE")"

  if [[ ! -f "$ENV_FILE" ]]; then
    DB_NAME="${DB_NAME:-team_ai_gateway}"
    DB_USER="${DB_USER:-team_ai_gateway}"
    DB_PASSWORD="${DB_PASSWORD:-$(random_alnum 28)}"
    AUTH_SECRET="${AUTH_SECRET:-$(random_hex 32)}"
    ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
    ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(random_alnum 18)}"
    ADMIN_NAME="${ADMIN_NAME:-Admin}"
    GENERATED_ADMIN_PASSWORD="$ADMIN_PASSWORD"
    ENV_CREATED="true"

    cat >"$ENV_FILE" <<EOF
DB_NAME="$DB_NAME"
DB_USER="$DB_USER"
DB_PASSWORD="$DB_PASSWORD"
DATABASE_URL="postgresql://$DB_USER:$DB_PASSWORD@127.0.0.1:5432/$DB_NAME?schema=public"
REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
CACHE_ENABLED="${CACHE_ENABLED:-true}"

AUTH_SECRET="$AUTH_SECRET"

AI_API_KEY="${AI_API_KEY:-}"
AI_API_BASE_URL="${AI_API_BASE_URL:-https://api.openai.com/v1}"
AI_MOCK_RESPONSES="${AI_MOCK_RESPONSES:-false}"

SITE_NAME="${SITE_NAME:-Team AI Gateway}"
SITE_URL="${SITE_URL:-}"

CODE_INTERPRETER_ENABLED="${CODE_INTERPRETER_ENABLED:-false}"
CODE_INTERPRETER_SANDBOX="${CODE_INTERPRETER_SANDBOX:-docker}"
CODE_INTERPRETER_DOCKER_IMAGE="${CODE_INTERPRETER_DOCKER_IMAGE:-python:3.12-slim}"
CODE_INTERPRETER_ALLOW_PACKAGE_INSTALL="${CODE_INTERPRETER_ALLOW_PACKAGE_INSTALL:-false}"
CODE_INTERPRETER_PIP_INDEX_URL="${CODE_INTERPRETER_PIP_INDEX_URL:-https://pypi.org/simple}"
CODE_INTERPRETER_TIMEOUT_MS="${CODE_INTERPRETER_TIMEOUT_MS:-45000}"
CODE_INTERPRETER_PACKAGE_CACHE="${CODE_INTERPRETER_PACKAGE_CACHE:-true}"
CODE_INTERPRETER_CACHE_DIR="${CODE_INTERPRETER_CACHE_DIR:-.cache/code-interpreter}"
CODE_INTERPRETER_PACKAGE_INSTALL_TIMEOUT_MS="${CODE_INTERPRETER_PACKAGE_INSTALL_TIMEOUT_MS:-120000}"
CODE_INTERPRETER_DOCKER_MEMORY="${CODE_INTERPRETER_DOCKER_MEMORY:-768m}"
CODE_INTERPRETER_DOCKER_CPUS="${CODE_INTERPRETER_DOCKER_CPUS:-1}"

WEB_SEARCH_ENABLED="${WEB_SEARCH_ENABLED:-false}"
WEB_SEARCH_PROVIDER="${WEB_SEARCH_PROVIDER:-duckduckgo}"
WEB_SEARCH_MAX_RESULTS="${WEB_SEARCH_MAX_RESULTS:-5}"

REGISTRATION_ENABLED="${REGISTRATION_ENABLED:-false}"
REGISTRATION_REQUIRE_EMAIL_VERIFICATION="${REGISTRATION_REQUIRE_EMAIL_VERIFICATION:-false}"
REGISTRATION_DEFAULT_COST_LIMIT_CENTS="${REGISTRATION_DEFAULT_COST_LIMIT_CENTS:-5000}"

SMTP_ENABLED="${SMTP_ENABLED:-false}"
SMTP_HOST="${SMTP_HOST:-}"
SMTP_PORT="${SMTP_PORT:-587}"
SMTP_USERNAME="${SMTP_USERNAME:-}"
SMTP_PASSWORD="${SMTP_PASSWORD:-}"
SMTP_FROM_EMAIL="${SMTP_FROM_EMAIL:-}"
SMTP_FROM_NAME="${SMTP_FROM_NAME:-}"
SMTP_SECURE="${SMTP_SECURE:-false}"
SMTP_STARTTLS="${SMTP_STARTTLS:-true}"

ADMIN_EMAIL="$ADMIN_EMAIL"
ADMIN_PASSWORD="$ADMIN_PASSWORD"
ADMIN_NAME="$ADMIN_NAME"
EOF
  else
    load_env_file
    set_db_defaults
    append_env_line_if_missing "DB_NAME" "$DB_NAME"
    append_env_line_if_missing "DB_USER" "$DB_USER"
    append_env_line_if_missing "DB_PASSWORD" "$DB_PASSWORD"

    if [[ -z "${DATABASE_URL:-}" ]]; then
      append_env_line_if_missing \
        "DATABASE_URL" \
        "postgresql://$DB_USER:$DB_PASSWORD@127.0.0.1:5432/$DB_NAME?schema=public"
    fi

    append_env_line_if_missing "REDIS_URL" "${REDIS_URL:-redis://127.0.0.1:6379}"
    append_env_line_if_missing "CACHE_ENABLED" "${CACHE_ENABLED:-true}"

    if [[ -z "${AUTH_SECRET:-}" ]]; then
      append_env_line_if_missing "AUTH_SECRET" "$(random_hex 32)"
    fi

    if [[ -z "${ADMIN_EMAIL:-}" ]]; then
      append_env_line_if_missing "ADMIN_EMAIL" "admin@example.com"
    fi

    if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
      GENERATED_ADMIN_PASSWORD="$(random_alnum 18)"
      append_env_line_if_missing "ADMIN_PASSWORD" "$GENERATED_ADMIN_PASSWORD"
    fi

    append_env_line_if_missing "ADMIN_NAME" "${ADMIN_NAME:-Admin}"
    append_env_line_if_missing "REGISTRATION_ENABLED" "${REGISTRATION_ENABLED:-false}"
    append_env_line_if_missing \
      "REGISTRATION_REQUIRE_EMAIL_VERIFICATION" \
      "${REGISTRATION_REQUIRE_EMAIL_VERIFICATION:-false}"
    append_env_line_if_missing \
      "REGISTRATION_DEFAULT_COST_LIMIT_CENTS" \
      "${REGISTRATION_DEFAULT_COST_LIMIT_CENTS:-5000}"
    append_env_line_if_missing "SMTP_ENABLED" "${SMTP_ENABLED:-false}"
    append_env_line_if_missing "SMTP_HOST" "${SMTP_HOST:-}"
    append_env_line_if_missing "SMTP_PORT" "${SMTP_PORT:-587}"
    append_env_line_if_missing "SMTP_USERNAME" "${SMTP_USERNAME:-}"
    append_env_line_if_missing "SMTP_PASSWORD" "${SMTP_PASSWORD:-}"
    append_env_line_if_missing "SMTP_FROM_EMAIL" "${SMTP_FROM_EMAIL:-}"
    append_env_line_if_missing "SMTP_FROM_NAME" "${SMTP_FROM_NAME:-}"
    append_env_line_if_missing "SMTP_SECURE" "${SMTP_SECURE:-false}"
    append_env_line_if_missing "SMTP_STARTTLS" "${SMTP_STARTTLS:-true}"
    append_env_line_if_missing "CODE_INTERPRETER_PACKAGE_CACHE" "${CODE_INTERPRETER_PACKAGE_CACHE:-true}"
    append_env_line_if_missing "CODE_INTERPRETER_CACHE_DIR" "${CODE_INTERPRETER_CACHE_DIR:-.cache/code-interpreter}"
    append_env_line_if_missing \
      "CODE_INTERPRETER_PACKAGE_INSTALL_TIMEOUT_MS" \
      "${CODE_INTERPRETER_PACKAGE_INSTALL_TIMEOUT_MS:-120000}"
  fi

  chmod 600 "$ENV_FILE"
  if [[ "$(id -u)" -eq 0 && "$APP_USER" != "root" ]]; then
    chown "$APP_USER:$APP_GROUP" "$ENV_FILE"
  fi

  load_env_file
  set_db_defaults
}

setup_postgres() {
  if [[ "$SKIP_LOCAL_POSTGRES" == "true" ]]; then
    log "Skipping local PostgreSQL setup because SKIP_LOCAL_POSTGRES=true."
    return
  fi

  if [[ "$DB_HOST" != "127.0.0.1" && "$DB_HOST" != "localhost" ]]; then
    log "DATABASE_URL points to $DB_HOST; skipping local PostgreSQL setup."
    return
  fi

  validate_pg_identifier "$DB_NAME" "DB_NAME"
  validate_pg_identifier "$DB_USER" "DB_USER"

  log "Ensuring PostgreSQL database and role exist..."
  as_root systemctl enable --now postgresql

  local db_user_sql db_password_sql db_name_sql
  db_user_sql="$(sql_escape "$DB_USER")"
  db_password_sql="$(sql_escape "$DB_PASSWORD")"
  db_name_sql="$(sql_escape "$DB_NAME")"

  as_user postgres psql -v ON_ERROR_STOP=1 --dbname postgres <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$db_user_sql') THEN
    CREATE ROLE "$DB_USER" LOGIN PASSWORD '$db_password_sql';
  ELSE
    ALTER ROLE "$DB_USER" LOGIN PASSWORD '$db_password_sql';
  END IF;
END
\$\$;

SELECT 'CREATE DATABASE "$DB_NAME" OWNER "$DB_USER"'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$db_name_sql')\\gexec

ALTER DATABASE "$DB_NAME" OWNER TO "$DB_USER";
SQL
}

prepare_app_dir() {
  mkdir -p "$APP_DIR/uploads" "$APP_DIR/logs" "$APP_DIR/.cache/code-interpreter"

  if [[ "$(id -u)" -eq 0 && "$APP_USER" != "root" ]]; then
    chown -R "$APP_USER:$APP_GROUP" "$APP_DIR/uploads" "$APP_DIR/logs" "$APP_DIR/.cache"
  fi
}

install_node_dependencies() {
  log "Installing Node dependencies..."
  if [[ -f "$APP_DIR/package-lock.json" ]]; then
    run_as_app_user npm ci
  else
    run_as_app_user npm install
  fi
}

build_application() {
  log "Syncing Prisma schema..."
  run_as_app_user npm run db:push

  if [[ ! -f "$APP_DIR/.deploy-seeded" || "${SEED_ADMIN:-false}" == "true" ]]; then
    log "Seeding administrator account..."
    run_as_app_user npm run db:seed
    run_as_app_user touch .deploy-seeded
  fi

  log "Building Next.js application..."
  run_as_app_user npm run build
}

write_systemd_service() {
  local npm_path escaped_app_dir escaped_env_file

  npm_path="$(command -v npm)"
  escaped_app_dir="$(systemd_escape_path "$APP_DIR")"
  escaped_env_file="$(systemd_escape_path "$ENV_FILE")"

  log "Writing systemd service: $SERVICE_NAME"
  as_root tee "/etc/systemd/system/${SERVICE_NAME}.service" >/dev/null <<EOF
[Unit]
Description=Team AI Gateway
After=network.target postgresql.service

[Service]
Type=simple
User=$APP_USER
Group=$APP_GROUP
WorkingDirectory=$escaped_app_dir
EnvironmentFile=$escaped_env_file
Environment=NODE_ENV=production
Environment=NEXT_TELEMETRY_DISABLED=1
ExecStart=$npm_path run start -- --hostname $APP_HOST --port $APP_PORT
Restart=always
RestartSec=5
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
EOF

  as_root systemctl daemon-reload
  as_root systemctl enable "$SERVICE_NAME"
}

setup_nginx() {
  if [[ "$SETUP_NGINX" != "true" ]]; then
    return
  fi

  [[ -n "$DOMAIN" ]] || fail "Set DOMAIN=your.domain.com when SETUP_NGINX=true."

  log "Installing and configuring nginx reverse proxy for $DOMAIN..."
  as_root apt-get install -y nginx

  local nginx_name
  nginx_name="$(printf '%s' "$APP_NAME" | tr -cs 'A-Za-z0-9_.-' '-')"

  as_root tee "/etc/nginx/sites-available/$nginx_name" >/dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
EOF

  as_root ln -sf "/etc/nginx/sites-available/$nginx_name" "/etc/nginx/sites-enabled/$nginx_name"
  as_root nginx -t
  as_root systemctl enable --now nginx
  as_root systemctl reload nginx
}

start_service() {
  log "Starting service..."
  as_root systemctl restart "$SERVICE_NAME"
  as_root systemctl --no-pager --full status "$SERVICE_NAME" || true
}

deploy_app() {
  ensure_env_file
  ensure_redis
  prepare_app_dir
  install_node_dependencies
  setup_postgres
  build_application
  write_systemd_service
  setup_nginx
  start_service
}

install_all() {
  install_system_packages
  deploy_app

  log "Deployment finished."
  log "Local URL: http://127.0.0.1:$APP_PORT"
  if [[ "$SETUP_NGINX" == "true" && -n "$DOMAIN" ]]; then
    log "Public URL: http://$DOMAIN"
  fi
  if [[ "$ENV_CREATED" == "true" || -n "$GENERATED_ADMIN_PASSWORD" ]]; then
    warn "Generated admin login: ${ADMIN_EMAIL:-admin@example.com} / $GENERATED_ADMIN_PASSWORD"
    warn "The generated password is saved in $ENV_FILE. Change it after first login."
  fi
}

update_app() {
  ensure_env_file
  ensure_redis

  if [[ -d "$APP_DIR/.git" ]]; then
    log "Pulling latest code from GitHub..."
    run_as_app_user git fetch --all --prune
    run_as_app_user git pull --ff-only
  else
    warn "$APP_DIR is not a Git repository; skipping git pull."
  fi

  prepare_app_dir
  install_node_dependencies
  setup_postgres
  build_application
  write_systemd_service
  setup_nginx
  start_service
}

migrate_sqlite() {
  ensure_env_file
  install_node_dependencies
  setup_postgres
  run_as_app_user npm run db:push
  run_as_app_user npm run db:migrate:sqlite-to-pg
  start_service
}

print_usage() {
  cat <<EOF
Usage:
  ./deploy.sh install          Install environment, create DB, build, and start systemd service
  ./deploy.sh deploy           Build and deploy current code without apt package installation
  ./deploy.sh update           git pull --ff-only, install deps, db push, build, restart
  ./deploy.sh migrate-sqlite   Import old dev.db into PostgreSQL
  ./deploy.sh restart          Restart systemd service
  ./deploy.sh stop             Stop systemd service
  ./deploy.sh status           Show service status
  ./deploy.sh logs             Follow service logs

Common environment overrides:
  APP_PORT=20132 ./deploy.sh install
  APP_USER=www-data ./deploy.sh install
  SKIP_LOCAL_POSTGRES=true DATABASE_URL='postgresql://user:pass@host:5432/db?schema=public' ./deploy.sh install
  SETUP_NGINX=true DOMAIN=example.com ./deploy.sh install
  INSTALL_DOCKER=true ./deploy.sh install
  SEED_ADMIN=true ./deploy.sh deploy
EOF
}

main() {
  cd "$APP_DIR"

  case "${1:-install}" in
    install)
      install_all
      ;;
    deploy)
      deploy_app
      ;;
    update)
      update_app
      ;;
    migrate-sqlite)
      migrate_sqlite
      ;;
    restart)
      as_root systemctl restart "$SERVICE_NAME"
      ;;
    stop)
      as_root systemctl stop "$SERVICE_NAME"
      ;;
    status)
      as_root systemctl --no-pager --full status "$SERVICE_NAME"
      ;;
    logs)
      as_root journalctl -u "$SERVICE_NAME" -n 100 -f
      ;;
    help|-h|--help)
      print_usage
      ;;
    *)
      print_usage
      fail "Unknown command: $1"
      ;;
  esac
}

main "$@"
