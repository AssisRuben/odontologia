#!/usr/bin/env bash
# Funções usadas por backup.sh e conferir-restauracao.sh. Nunca imprimem a conexão ou a senha.

CHAVES_CONF='DB_URL DB_CA PG_IMAGE DIR_LOCAL REMOTO_STORAGE REMOTO_DRIVE RETENCAO_LOCAL_DIAS RETENCAO_DRIVE_DIAS HEALTHCHECK_URL'

log() { echo "[$(date '+%F %T')] $*"; }

avisar() {
  # Healthchecks.io (opcional): sem ping de sucesso no dia, ele manda e-mail.
  if [ -n "${HEALTHCHECK_URL:-}" ]; then
    curl -fsS -m 10 --retry 3 "$HEALTHCHECK_URL$1" >/dev/null || true
  fi
}

morrer() {
  log "ERRO: $*"
  avisar "/fail"
  exit 1
}

# Lê o arquivo como dados: uma senha com $, & ou ; não pode virar comando do shell.
ler_conf() {
  local arquivo="$1" linha chave valor
  [ -r "$arquivo" ] || morrer "não consegui ler $arquivo"
  while IFS= read -r linha || [ -n "$linha" ]; do
    linha="${linha%$'\r'}"
    case "$linha" in '' | \#* | [[:space:]]*) continue ;; esac
    case "$linha" in *=*) ;; *) morrer "linha inválida em $arquivo" ;; esac
    chave="${linha%%=*}"
    valor="${linha#*=}"
    case " $CHAVES_CONF " in *" $chave "*) ;; *) morrer "chave desconhecida em $arquivo: $chave" ;; esac
    case "$valor" in
      \"*\") valor="${valor#\"}"; valor="${valor%\"}" ;;
      \'*\') valor="${valor#\'}"; valor="${valor%\'}" ;;
    esac
    printf -v "$chave" '%s' "$valor"
  done <"$arquivo"

  : "${DB_URL:?defina DB_URL em $arquivo}"
  DB_CA="${DB_CA:-/opt/backup/supabase-ca.crt}"
  PG_IMAGE="${PG_IMAGE:-postgres:17-alpine}"
  DIR_LOCAL="${DIR_LOCAL:-/opt/backup/banco}"
  REMOTO_STORAGE="${REMOTO_STORAGE:-supabase-s3:}"
  REMOTO_DRIVE="${REMOTO_DRIVE:-gdrive-cripto:}"
  RETENCAO_LOCAL_DIAS="${RETENCAO_LOCAL_DIAS:-3}"
  RETENCAO_DRIVE_DIAS="${RETENCAO_DRIVE_DIAS:-60}"
  HEALTHCHECK_URL="${HEALTHCHECK_URL:-}"
}

decodificar() {
  local s="${1//\\/\\\\}"
  printf '%b' "${s//%/\\x}"
}

# Passa a conexão por variáveis herdadas: a senha não aparece na lista de processos.
# verify-full exige certificado válido da CA do Supabase e nome de servidor correto.
preparar_conexao() {
  local re='^postgres(ql)?://([^:/@?]+):([^@/?]+)@([^:/?]+)(:([0-9]+))?/([^?]+)(\?(.*))?$'
  [[ "$DB_URL" =~ $re ]] || morrer "DB_URL em formato inválido (símbolos da senha precisam estar codificados)"
  local usuario="${BASH_REMATCH[2]}" senha="${BASH_REMATCH[3]}" servidor="${BASH_REMATCH[4]}"
  local porta="${BASH_REMATCH[6]}" banco="${BASH_REMATCH[7]}" params="${BASH_REMATCH[9]}"
  case "$params" in '' | sslmode=require | sslmode=verify-ca | sslmode=verify-full) ;;
    *) morrer "DB_URL aceita apenas o parâmetro sslmode com TLS" ;;
  esac
  [ -r "$DB_CA" ] || morrer "certificado do Supabase não encontrado em $DB_CA"

  PGUSER="$(decodificar "$usuario")"
  PGPASSWORD="$(decodificar "$senha")"
  PGHOST="$servidor"
  PGPORT="${porta:-5432}"
  PGDATABASE="$(decodificar "$banco")"
  PGSSLMODE=verify-full
  PGSSLROOTCERT=/run/supabase-ca.crt
  export PGUSER PGPASSWORD PGHOST PGPORT PGDATABASE PGSSLMODE PGSSLROOTCERT
}

pg_docker() {
  docker run --rm --network host \
    -e PGUSER -e PGPASSWORD -e PGHOST -e PGPORT -e PGDATABASE -e PGSSLMODE -e PGSSLROOTCERT \
    -v "$DB_CA:/run/supabase-ca.crt:ro" -v "$DIR_LOCAL:/out" "$PG_IMAGE" "$@"
}
