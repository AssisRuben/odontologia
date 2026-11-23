# Backup da produção (VPS → Google Drive)

O `backup.sh` roda todo dia na VPS e:

1. exporta o banco de produção (`pg_dump` dos schemas `public`, `auth` e `storage`) por TLS
   verificado e lê o arquivo inteiro para confirmar que ele está íntegro: cópia na VPS por
   3 dias (sem criptografia, em pasta só do root) e no Google Drive por 60 dias;
2. copia os arquivos do Storage (buckets `anneOdonto` e `expense-receipts`) direto
   do Supabase para o Drive, sem nunca apagar nada no destino;
3. envia tudo **criptografado** (rclone crypt): no Drive só aparecem nomes embaralhados.

> **As duas senhas da criptografia são a única forma de abrir o backup.**
> Guarde-as no gerenciador de senhas assim que criar (passo 4). Sem elas o backup é inútil.

## Instalação (uma vez, na VPS)

### 1. Pastas e script

```bash
ssh root@189.24.5.150
mkdir -p /opt/backup/banco
chmod 700 /opt/backup /opt/backup/banco
BASE=https://raw.githubusercontent.com/fiusajr/odontologia/main/scripts/backup
for f in backup.sh comum.sh conferir-restauracao.sh; do curl -fsSL -o "/opt/backup/$f" "$BASE/$f"; done
curl -fsSL -o /opt/backup/backup.env "$BASE/backup.env.example"
chmod 700 /opt/backup/*.sh && chmod 600 /opt/backup/backup.env
```

Os arquivos só existem nesse endereço depois do merge em `main`.

### 2. Conexão do banco

1. Supabase **sistemadental-prod** > botão **Connect** > **Session pooler**: copie a URI.
2. Veja a versão do Postgres em **Project Settings > Infrastructure**.
3. `nano /opt/backup/backup.env`: cole a URI em `DB_URL` (com a senha do banco no lugar de
   `[YOUR-PASSWORD]`) e ajuste `PG_IMAGE` se a versão não for 17 (ex.: `postgres:15-alpine`).
   Salve com Ctrl+O, Enter, Ctrl+X.
4. Em **Project Settings > Database > SSL Configuration**, clique em **Download certificate**.
   No PowerShell do Windows, envie o arquivo para a VPS (ajuste o caminho do download):

   ```powershell
   scp "$HOME\Downloads\prod-ca-2021.crt" root@189.24.5.150:/opt/backup/supabase-ca.crt
   ```

   Na VPS: `chmod 600 /opt/backup/supabase-ca.crt`. Use o certificado da **produção**.

### 3. rclone e acesso ao Storage

```bash
curl -fsSL https://rclone.org/install.sh | bash
```

No Supabase **sistemadental-prod** > **Project Settings > Storage > S3 Connection**:
anote o **Endpoint** e a **Region** e clique em **New access key** (anote o Access key ID e o
Secret access key). Depois:

```bash
mkdir -p ~/.config/rclone
cat >> ~/.config/rclone/rclone.conf <<'EOF'
[supabase-s3]
type = s3
provider = Other
endpoint = COLE_O_ENDPOINT
region = COLE_A_REGION
access_key_id = COLE_O_ACCESS_KEY_ID
secret_access_key = COLE_O_SECRET_ACCESS_KEY
force_path_style = true
EOF
chmod 600 ~/.config/rclone/rclone.conf
nano ~/.config/rclone/rclone.conf   # substitua os COLE_...
rclone lsd supabase-s3:             # deve listar anneOdonto e expense-receipts
```

### 4. Google Drive (com criptografia)

O login no Google precisa de um navegador, então uma parte é feita no seu computador.

**No Windows (PowerShell):** `winget install Rclone.Rclone` e feche/reabra o PowerShell.

**Na VPS:** `rclone config` e responda:

| Pergunta | Resposta |
|---|---|
| `n/s/q>` | `n` (novo remote) |
| `name>` | `gdrive` |
| `Storage>` | `drive` |
| `client_id>` e `client_secret>` | Enter (vazio) |
| `scope>` | `drive.file` (o rclone só enxerga o que ele mesmo criar) |
| `service_account_file>` | Enter |
| `Edit advanced config?` | `n` |
| `Use web browser to automatically authenticate?` | `n` |

O rclone mostra um comando `rclone authorize "drive" "..."`. **Copie e rode no PowerShell do
Windows**: abre o navegador, entre na conta Google que vai guardar o backup e autorize.
O PowerShell mostra um token (bloco que começa com `{"access_token"...`): copie tudo e cole
na VPS. Depois: `Configure this as a Shared Drive?` → `n`; confirme com `y`.

Ainda no `rclone config`, crie o remote criptografado:

| Pergunta | Resposta |
|---|---|
| `n/s/q>` | `n` |
| `name>` | `gdrive-cripto` |
| `Storage>` | `crypt` |
| `remote>` | `gdrive:sistemadental-backup` |
| `filename_encryption>` | `standard` |
| `directory_name_encryption>` | `true` |
| `Password or pass phrase for encryption` | `g` (gerar) → `1024` → `y` |
| `Password or pass phrase for salt` | `g` → `1024` → `y` |
| `Edit advanced config?` | `n` |

**Copie as duas senhas geradas para o gerenciador de senhas agora** ("Sistema Dental – backup").
Saia com `q`. Teste:

```bash
echo teste > /tmp/t.txt && rclone copy /tmp/t.txt gdrive-cripto:teste/ && rclone ls gdrive-cripto:teste/
rclone purge gdrive-cripto:teste/
```

### 5. Primeira execução

```bash
/opt/backup/backup.sh
```

Deve terminar com `Backup concluído.` A primeira cópia do Storage pode demorar se já houver
muitos arquivos. No Google Drive aparece a pasta `sistemadental-backup` com nomes embaralhados
(é a criptografia funcionando). Para ver o conteúdo decifrado: `rclone tree gdrive-cripto:`.

Depois, prove que o backup pode ser recuperado:

```bash
/opt/backup/conferir-restauracao.sh
```

Ele baixa e decifra o último backup do Drive, restaura em um banco temporário sem rede, compara
as linhas de cada tabela com a produção (somente leitura) e compara o conteúdo de cada arquivo
do Storage. Só mostra contagens. O resultado esperado é `RESULTADO: backup restaurável e completo.`

- **Código 2 (contagens diferentes):** a clínica pode ter lançado algo depois do backup. Rode
  `backup.sh` e a conferência de novo, fora do horário de atendimento.
- **Código 1:** o backup não é confiável. Não importe dados reais até resolver.

Repita a conferência **antes da importação** e depois **uma vez por mês**. Ela baixa todos os
arquivos do Storage, então evite o horário de atendimento.

### 6. Agendar (todo dia às 03:30 de Brasília)

```bash
cat > /etc/cron.d/sistemadental-backup <<'EOF'
30 6 * * * root /opt/backup/backup.sh >> /var/log/sistemadental-backup.log 2>&1
EOF
```

Ver o resultado das execuções: `tail -50 /var/log/sistemadental-backup.log`

### 7. (Opcional) Aviso por e-mail se falhar

Crie uma conta grátis em healthchecks.io, um check com período **1 dia** e tolerância
**2 horas**, e cole a URL de ping em `HEALTHCHECK_URL` no `backup.env`. Se o backup falhar
ou não rodar, chega um e-mail.

## Guarde fora da VPS

No gerenciador de senhas, nota "Sistema Dental – backup":
- as duas senhas do `gdrive-cripto` (passo 4);
- o conteúdo de `~/.config/rclone/rclone.conf` (`cat ~/.config/rclone/rclone.conf`).

Se a VPS for perdida, com isso você instala o rclone em qualquer computador e baixa o backup.

## Restauração (resumo)

Baixar o backup decifrado (em qualquer máquina com o rclone.conf):

```bash
rclone copy gdrive-cripto:banco/ ./banco/ --include "banco_2026-12-01_*"   # escolha a data
rclone copy gdrive-cripto:storage/ ./storage/
```

Restaurar num projeto Supabase **novo e vazio**:

1. Ative `pg_cron` e `pg_net`; rode `supabase/schema.sql` no SQL Editor (estrutura, gatilhos,
   políticas e buckets). Não rode o arquivo da TUSS: os dados vêm do backup.
2. Importe os dados com gatilhos desligados, sem os buckets (já criados no passo 1) e sem as
   tabelas internas de versão do Supabase (o projeto novo já tem as dele):

   ```bash
   # ca-novo.crt: certificado do projeto novo (Project Settings > Database > SSL Configuration)
   export NOVO="postgresql://postgres.NOVO_REF:SENHA@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=/ca.crt"
   docker run --rm -e NOVO -v "$PWD/banco:/b:ro" -v "$PWD/ca-novo.crt:/ca.crt:ro" postgres:17-alpine sh -c \
     'pg_restore -l /b/ARQUIVO.dump | grep -vE "TABLE DATA (storage (buckets|migrations)|auth schema_migrations) " > /tmp/lista && \
      pg_restore --data-only --no-owner -L /tmp/lista -f - /b/ARQUIVO.dump | \
      psql "$NOVO" -q -v ON_ERROR_STOP=1 --single-transaction -c "SET session_replication_role = replica" -f -'
   unset NOVO
   ```

   A carga roda em uma única transação: se algo falhar, nada fica gravado.
3. Envie os arquivos: configure um remote `s3` para o projeto novo (como no passo 3) e rode
   `rclone copy ./storage/ novo-s3:`.
4. Rode `supabase/agendamentos.sql`, troque as chaves do Supabase no Coolify e faça Redeploy.

O `conferir-restauracao.sh` prova que os dados e arquivos podem ser recuperados, mas não sobe
um Supabase completo. Faça este roteiro uma vez em um projeto descartável antes de precisar dele
de verdade, incluindo login, abertura de um documento e o apontamento do app.
