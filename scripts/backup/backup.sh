#!/usr/bin/env bash
# Backup diário da produção do Sistema Dental (roda na VPS, pelo cron).
#
#  1. Banco: pg_dump (formato custom) dos schemas public, auth e storage, por TLS verificado.
#     O arquivo é lido por inteiro antes de valer como backup.
#     -> guardado na VPS (RETENCAO_LOCAL_DIAS) e no Google Drive (RETENCAO_DRIVE_DIAS).
#  2. Arquivos do Storage (todos os buckets) -> copiados direto do Supabase para o Drive.
#     Usa "rclone copy": nunca apaga no destino, então arquivo removido no app
#     continua no backup.
#  O Drive recebe tudo pelo remote criptografado (rclone crypt).
#
# Configuração: /opt/backup/backup.env (veja backup.env.example), o certificado do Supabase
# e o rclone.conf com os remotes "supabase-s3" e "gdrive-cripto". Passo a passo: README.md.
set -Eeuo pipefail
umask 077

# shellcheck source=comum.sh
source "$(dirname "$(readlink -f "$0")")/comum.sh"
CONF="${BACKUP_ENV:-/opt/backup/backup.env}"
ler_conf "$CONF"

falhou() {
  log "ERRO na linha $1. Backup NÃO concluído."
  avisar "/fail"
}
trap 'falhou $LINENO' ERR

# Evita duas execuções ao mesmo tempo.
exec 9>/var/lock/sistemadental-backup.lock
flock -n 9 || { log "Outro backup em andamento; saindo."; exit 0; }

avisar "/start"
preparar_conexao
mkdir -p "$DIR_LOCAL"
chmod 700 "$DIR_LOCAL"

CARIMBO="$(date -u '+%Y-%m-%d_%H%M')"
NOME="banco_$CARIMBO.dump"
ARQ="$DIR_LOCAL/$NOME"
PARCIAL="$ARQ.parcial"
trap 'rm -f "$PARCIAL"' EXIT

# ── 1. Banco ─────────────────────────────────────────────────
log "Exportando o banco..."
pg_docker pg_dump --format=custom --no-owner --no-privileges \
  --schema=public --schema=auth --schema=storage \
  --file="/out/$NOME.parcial"

# Lê todo o conteúdo: um arquivo truncado ou corrompido falha aqui.
pg_docker pg_restore --file=/dev/null "/out/$NOME.parcial"
LISTA="$(pg_docker pg_restore --list "/out/$NOME.parcial")"
TABELAS="$(grep -c "TABLE DATA" <<<"$LISTA" || true)"
if [ "$TABELAS" -lt 10 ]; then
  log "Dump suspeito: só $TABELAS tabelas com dados."
  false
fi
chmod 600 "$PARCIAL"
mv "$PARCIAL" "$ARQ"
log "Banco OK: $(du -h "$ARQ" | cut -f1), $TABELAS tabelas com dados."

log "Enviando o banco para o Drive..."
rclone copy "$ARQ" "${REMOTO_DRIVE}banco/" --retries 5
rclone cryptcheck "$DIR_LOCAL" "${REMOTO_DRIVE}banco/" --one-way --include "$NOME" --log-level ERROR
log "Cópia do banco no Drive conferida."

# ── 2. Arquivos (Storage) ────────────────────────────────────
log "Copiando os arquivos do Storage para o Drive..."
BUCKETS="$(rclone lsf "$REMOTO_STORAGE" --dirs-only)"
if ! grep -qx 'anneOdonto/' <<<"$BUCKETS"; then
  log "Bucket anneOdonto não encontrado no Storage."
  false
fi
rclone copy "$REMOTO_STORAGE" "${REMOTO_DRIVE}storage/" \
  --retries 5 --transfers 4 --checkers 8 --log-level ERROR

# ── 3. Limpeza (só depois de um backup completo) ─────────────
log "Removendo cópias antigas do banco..."
find "$DIR_LOCAL" -name 'banco_*.dump' -mtime +"$RETENCAO_LOCAL_DIAS" -delete
rclone delete "${REMOTO_DRIVE}banco/" --min-age "${RETENCAO_DRIVE_DIAS}d"

log "Backup concluído."
avisar ""
