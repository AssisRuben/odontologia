#!/usr/bin/env bash
# Prova que o último backup do Drive pode ser recuperado, sem tocar na produção:
#  1. baixa e decifra o dump mais recente;
#  2. restaura em um Postgres temporário, sem rede, apagado ao final;
#  3. compara as linhas de cada tabela com o banco de produção (somente leitura);
#  4. compara o conteúdo de cada arquivo do Storage com a cópia do Drive.
#
# Saída: só contagens e nomes de tabelas, nunca dados de pacientes ou nomes de arquivos.
# Código de saída: 0 tudo igual | 2 contagens diferentes (rode logo após um backup) | 1 falha.
set -Eeuo pipefail
umask 077

# shellcheck source=comum.sh
source "$(dirname "$(readlink -f "$0")")/comum.sh"
CONF="${BACKUP_ENV:-/opt/backup/backup.env}"
ler_conf "$CONF"
HEALTHCHECK_URL=""   # a conferência é manual: não mexe no aviso do backup diário
preparar_conexao
mkdir -p "$DIR_LOCAL"
chmod 700 "$DIR_LOCAL"

exec 9>/var/lock/sistemadental-backup.lock
flock -n 9 || morrer "um backup está em andamento; tente depois"

TRAB="$(mktemp -d "$(dirname "$DIR_LOCAL")/conferencia.XXXXXX")"
PG_TESTE="conferencia-backup-$$"
limpar() {
  docker rm -fv "$PG_TESTE" >/dev/null 2>&1 || true
  rm -rf "$TRAB"
}
trap limpar EXIT
trap 'log "ERRO na linha $LINENO. Conferência NÃO concluída."' ERR

# ── 1. Baixar e decifrar ─────────────────────────────────────
ULTIMO="$(rclone lsf "${REMOTO_DRIVE}banco/" --files-only --include 'banco_*.dump' | LC_ALL=C sort | tail -n 1)"
[ -n "$ULTIMO" ] || morrer "nenhum backup do banco encontrado no Drive"
log "Baixando e decifrando o backup $ULTIMO..."
rclone copyto "${REMOTO_DRIVE}banco/$ULTIMO" "$TRAB/backup.dump" --log-level ERROR
chmod 644 "$TRAB/backup.dump"
chmod 755 "$TRAB"

DATA="${ULTIMO#banco_}"
DATA="${DATA%%_*}"
IDADE=$(( ($(date -u +%s) - $(date -u -d "$DATA" +%s)) / 86400 ))
[ "$IDADE" -le 2 ] || morrer "o backup mais recente tem $IDADE dias"

# ── 2. Restaurar em banco temporário, sem rede ───────────────
log "Restaurando em um banco temporário..."
docker run -d --name "$PG_TESTE" --network none -e POSTGRES_HOST_AUTH_METHOD=trust \
  -v "$TRAB:/b:ro" "$PG_IMAGE" >/dev/null
for _ in $(seq 1 60); do
  if docker exec "$PG_TESTE" pg_isready -q -h 127.0.0.1 -U postgres; then break; fi
  sleep 1
done
docker exec "$PG_TESTE" pg_isready -q -h 127.0.0.1 -U postgres || morrer "o banco temporário não iniciou"

docker exec "$PG_TESTE" psql -q -U postgres -v ON_ERROR_STOP=1 -c "
  DO \$\$ DECLARE r text; BEGIN
    FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','supabase_admin','supabase_auth_admin','supabase_storage_admin','authenticator','dashboard_user'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN', r); END IF;
    END LOOP;
  END \$\$;
  CREATE SCHEMA IF NOT EXISTS extensions;
  CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;
  CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\" SCHEMA extensions;
  ALTER DATABASE postgres SET search_path = public, extensions;"

# Erros podem citar linhas de dados: ficam só no arquivo temporário, apagado ao final.
docker exec "$PG_TESTE" pg_restore -U postgres -d postgres --no-owner --no-privileges /b/backup.dump \
  >"$TRAB/restauracao.log" 2>&1 || true
FALHAS_DADOS="$(grep -E 'from TOC entry .* TABLE DATA ' "$TRAB/restauracao.log" | sed -E 's/.*TABLE DATA ([^ ]+) ([^ ]+).*/\1.\2/' | LC_ALL=C sort -u || true)"
if [ -n "$FALHAS_DADOS" ]; then
  log "Tabelas com falha ao restaurar:"
  echo "$FALHAS_DADOS"
  morrer "o backup não restaurou todos os dados"
fi

# ── 3. Comparar linhas por tabela ────────────────────────────
TABELAS="$(pg_docker psql -AtX -v ON_ERROR_STOP=1 -c "SELECT quote_ident(schemaname) || '.' || quote_ident(tablename) FROM pg_tables WHERE schemaname IN ('public','auth','storage') ORDER BY 1")"
[ -n "$TABELAS" ] || morrer "não consegui listar as tabelas da produção"
CONSULTA=""
while IFS= read -r t; do
  CONSULTA+="${CONSULTA:+ UNION ALL }SELECT '$t', count(*) FROM $t"
done <<<"$TABELAS"

pg_docker psql -qAtX -F '|' -v ON_ERROR_STOP=1 -c 'BEGIN TRANSACTION READ ONLY' -c "$CONSULTA" -c 'ROLLBACK' \
  | LC_ALL=C sort -t '|' -k1,1 >"$TRAB/producao.txt"
docker exec "$PG_TESTE" psql -U postgres -qAtX -F '|' -v ON_ERROR_STOP=1 -c "$CONSULTA" \
  2>"$TRAB/contagem.log" | LC_ALL=C sort -t '|' -k1,1 >"$TRAB/restaurado.txt" \
  || morrer "tabela da produção ausente no backup restaurado"

TOTAL=0; IGUAIS=0; LINHAS=0; DIFERENTES=""
while IFS='|' read -r tabela prod rest; do
  TOTAL=$((TOTAL + 1))
  if [ "$prod" = "$rest" ]; then
    IGUAIS=$((IGUAIS + 1))
    LINHAS=$((LINHAS + rest))
  else
    DIFERENTES+="  $tabela: produção $prod, backup $rest"$'\n'
  fi
done < <(LC_ALL=C join -t '|' -a 1 -a 2 -e 'ausente' -o 0,1.2,2.2 "$TRAB/producao.txt" "$TRAB/restaurado.txt")
log "Banco: $IGUAIS de $TOTAL tabelas iguais, $LINHAS linhas conferidas."

# ── 4. Comparar o conteúdo dos arquivos ──────────────────────
log "Comparando os arquivos do Storage com o Drive..."
rclone check "$REMOTO_STORAGE" "${REMOTO_DRIVE}storage/" --one-way --download \
  --combined "$TRAB/arquivos.txt" --log-level CRITICAL >/dev/null 2>&1 || true
[ -f "$TRAB/arquivos.txt" ] || morrer "a comparação de arquivos não rodou"
ARQ_OK="$(grep -c '^= ' "$TRAB/arquivos.txt" || true)"
ARQ_RUINS="$(grep -cv '^= ' "$TRAB/arquivos.txt" || true)"
log "Arquivos: $ARQ_OK iguais, $ARQ_RUINS ausentes ou diferentes."

if [ "$ARQ_RUINS" -gt 0 ]; then
  morrer "há arquivos do Storage sem cópia íntegra no Drive"
fi
if [ -n "$DIFERENTES" ]; then
  log "Tabelas com contagem diferente:"
  printf '%s' "$DIFERENTES"
  log "RESULTADO: revisar. Se a clínica estava usando o sistema, rode um backup e confira de novo."
  exit 2
fi
log "RESULTADO: backup restaurável e completo."
