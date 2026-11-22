#!/usr/bin/env bash
# Backup diário da produção do Sistema Dental (roda na VPS, pelo cron).
#
#  1. Banco: pg_dump (formato custom) dos schemas public, auth e storage
#     -> guardado na VPS (RETENCAO_LOCAL_DIAS) e no Google Drive (RETENCAO_DRIVE_DIAS).
#  2. Arquivos do Storage (todos os buckets) -> copiados direto do Supabase para o Drive.
#     Usa "rclone copy": nunca apaga no destino, então arquivo removido no app
#     continua no backup.
#  O Drive recebe tudo pelo remote criptografado (rclone crypt).
#
# Configuração: /opt/backup/backup.env (veja backup.env.example) e o rclone.conf
# com os remotes "supabase-s3" e "gdrive-cripto". Passo a passo: README.md.
set -Eeuo pipefail

CONF="${BACKUP_ENV:-/opt/backup/backup.env}"
# shellcheck source=/dev/null
source "$CONF"

: "${DB_URL:?defina DB_URL em $CONF}"
PG_IMAGE="${PG_IMAGE:-postgres:17-alpine}"
DIR_LOCAL="${DIR_LOCAL:-/opt/backup/banco}"
REMOTO_STORAGE="${REMOTO_STORAGE:-supabase-s3:}"
REMOTO_DRIVE="${REMOTO_DRIVE:-gdrive-cripto:}"
RETENCAO_LOCAL_DIAS="${RETENCAO_LOCAL_DIAS:-14}"
RETENCAO_DRIVE_DIAS="${RETENCAO_DRIVE_DIAS:-60}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-}"

log() { echo "[$(date '+%F %T')] $*"; }

avisar() {
  # Healthchecks.io (opcional): sem ping de sucesso no dia, ele manda e-mail.
  [ -n "$HEALTHCHECK_URL" ] && curl -fsS -m 10 --retry 3 "$HEALTHCHECK_URL$1" >/dev/null || true
}

falhou() {
  log "ERRO na linha $1. Backup NÃO concluído."
  avisar "/fail"
}
trap 'falhou $LINENO' ERR

# Evita duas execuções ao mesmo tempo.
exec 9>/var/lock/sistemadental-backup.lock
flock -n 9 || { log "Outro backup em andamento; saindo."; exit 0; }

avisar "/start"
CARIMBO="$(date -u '+%Y-%m-%d_%H%M')"
ARQ="$DIR_LOCAL/banco_$CARIMBO.dump"
mkdir -p "$DIR_LOCAL"

# ── 1. Banco ─────────────────────────────────────────────────
log "Exportando o banco..."
docker run --rm --network host -v "$DIR_LOCAL:/out" "$PG_IMAGE" \
  pg_dump "$DB_URL" --format=custom --no-owner --no-privileges \
  --schema=public --schema=auth --schema=storage \
  --file="/out/$(basename "$ARQ")"

# Confere se o arquivo abre e tem dados de tabelas.
TABELAS=$(docker run --rm -v "$DIR_LOCAL:/out" "$PG_IMAGE" \
  pg_restore --list "/out/$(basename "$ARQ")" | grep -c "TABLE DATA" || true)
if [ "$TABELAS" -lt 10 ]; then
  log "Dump suspeito: só $TABELAS tabelas com dados."
  false
fi
log "Banco OK: $(du -h "$ARQ" | cut -f1), $TABELAS tabelas com dados."

log "Enviando o banco para o Drive..."
rclone copy "$ARQ" "${REMOTO_DRIVE}banco/" --retries 5

# ── 2. Arquivos (Storage) ────────────────────────────────────
log "Copiando os arquivos do Storage para o Drive..."
rclone copy "$REMOTO_STORAGE" "${REMOTO_DRIVE}storage/" \
  --retries 5 --transfers 4 --checkers 8 --stats-one-line --stats 0

# ── 3. Limpeza ───────────────────────────────────────────────
log "Removendo cópias antigas do banco..."
find "$DIR_LOCAL" -name 'banco_*.dump' -mtime +"$RETENCAO_LOCAL_DIAS" -delete
rclone delete "${REMOTO_DRIVE}banco/" --min-age "${RETENCAO_DRIVE_DIAS}d"

log "Backup concluído."
avisar ""
