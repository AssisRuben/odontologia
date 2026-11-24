# Importação do Codental — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Importar um backup do Codental para uma clínica existente sem afetar financeiro, indicadores, estoque ou mensagens.

**Architecture:** O sistema ganha marca de origem, histórico financeiro separado e proteção para telefone compartilhado. Um script Node local lê as planilhas, simula por padrão e grava o banco em uma transação Postgres. Os arquivos vão em etapa separada e retomável.

**Tech Stack:** Next.js 16, Supabase/Postgres, Vitest, Node ESM, `pg` e `exceljs` (devDependencies).

**Spec:** `docs/superpowers/specs/2026-11-22-importacao-codental-design.md`

## Global Constraints

- Nunca usar dado real em teste, fixture, commit, log versionado ou mensagem de erro. Erros citam linha e coluna, não valores.
- O backup real fica fora do repositório e entra só por argumento de linha de comando.
- Fuso das datas do Codental: `America/Sao_Paulo`.
- Valor da marca: `imported_from = 'codental'`.
- SQL novo vai em `supabase/2026-11-22-importacao-codental.sql` e também em `supabase/schema.sql`, idempotente. O usuário roda o SQL à mão em cada banco.
- Ler o guia relevante em `node_modules/next/dist/docs/` antes de alterar telas.
- Rodar testes com o diretório em `C:\Workspace\odontologia` (C maiúsculo): `npx vitest run <arquivo>`.
- Não fazer push nem merge. Não executar nada contra homologação ou produção sem pedido explícito.

## Review Focus

- Reimportar com um export mais novo: registros já vinculados não são sobrescritos, e só os novos entram (Task 7).
- Consulta entre a data do export e a importação ainda agendada: vira cancelada sem desfecho (Task 5).
- Número compartilhado respondendo "1" ou "2" a uma confirmação: a confirmação continua valendo para a consulta certa (Task 3).
- Erro no meio da gravação: nenhuma linha fica no banco (Task 7).
- Coluna renomeada em export futuro: o importador para antes de gravar e aponta a coluna (Task 5).

---

### Task 1: Migração SQL

**Files:**
- Create: `supabase/2026-11-22-importacao-codental.sql`
- Modify: `supabase/schema.sql` (final do arquivo e função `treatments_material_status`, perto da linha 3620)
- Test: `tests/supabase/importacao-codental.test.ts`

**Interfaces:**
- Produces: colunas `imported_from TEXT` em `patients`, `appointments`, `treatments`, `budgets`; tabelas `import_links(clinic_id, source, entity, source_id, target_id, created_at)` com PK `(clinic_id, source, entity, source_id)`; `legacy_payments(id, clinic_id, patient_id, budget_id, source_id, description, amount, due_date, paid_at, payment_method, installment_number, installment_count, original_status, created_at)`.

- [ ] **Step 1: Escrever o teste que falha.** Para os dois arquivos SQL, com `describe.each`, afirmar que contêm: `ALTER TABLE patients ADD COLUMN IF NOT EXISTS imported_from TEXT`, o mesmo para as outras três tabelas, `CREATE TABLE IF NOT EXISTS import_links`, `CREATE TABLE IF NOT EXISTS legacy_payments`, `ALTER TABLE legacy_payments ENABLE ROW LEVEL SECURITY`, `ALTER TABLE import_links ENABLE ROW LEVEL SECURITY` e `IF NEW.status = 'completed' AND NEW.imported_from IS NULL`. Afirmar que não há policy de INSERT, UPDATE ou DELETE em `legacy_payments`.
- [ ] **Step 2: Rodar e ver falhar.** `npx vitest run tests/supabase/importacao-codental.test.ts`
- [ ] **Step 3: Escrever o SQL.** `legacy_payments` tem só policy SELECT por `public.user_clinic_ids()`. `import_links` fica sem policies. `original_status` aceita `paid` ou `open`. No ramo INSERT do gatilho de material, só marcar `pendente` quando `imported_from IS NULL`.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** `feat(importacao): tabelas de histórico e marca de origem`

### Task 2: Isolamento do histórico

**Files:**
- Modify: `src/lib/comissoes/repo.ts:108-117`, `src/lib/indicadores/repo.ts:46-87`, `src/lib/orcamentos/repo.ts:225-236`, `src/lib/messaging/cycleData.ts:75-85`, `src/lib/convenios/repo.ts:176-184` e `:827`
- Test: `tests/importacao/isolamento.test.ts`

**Interfaces:**
- Consumes: coluna `imported_from`.

- [ ] **Step 1: Escrever o teste que falha.** Com um cliente Supabase falso que registra `.from()` e `.is()`, afirmar `is('imported_from', null)` em: tratamentos de comissões; consultas, tratamentos e pacientes de indicadores; `budgets` do funil; consultas concluídas de `loadPlanInput`; tratamentos elegíveis para guia.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Adicionar `.is('imported_from', null)` a cada leitura listada.** Em `tratamentosParaGuia`, tratamento importado não pode ser devolvido como elegível.
- [ ] **Step 4: Rodar o teste e as suítes de comissões, indicadores, orçamentos, mensagens e convênios.** Ajustar apenas fakes que não conheçam `.is`.
- [ ] **Step 5: Commit** `feat(importacao): isola registros importados das rotinas`

### Task 3: Telefone compartilhado

**Files:**
- Modify: `src/lib/messaging/incoming.ts`, `src/lib/agente/conversa.ts`
- Test: `tests/messaging/incoming.test.ts`

**Interfaces:**
- Produces: `REASON_SHARED_PHONE = 'Número usado por mais de um paciente'`; `IncomingDeps.phoneShared(clinicId: string, phone: string): Promise<boolean>`.

- [ ] **Step 1: Escrever os testes que falham.**
  - `número compartilhado com agente ligado`: `saveIncoming` recebe `patient_id: null`, `setHandler(conv, 'human', REASON_SHARED_PHONE)` é chamado e `outcome.agent === null`.
  - `número compartilhado com agente desligado`: a mensagem é guardada, sem handoff.
  - `número compartilhado responde "1"`: a confirmação alvo é confirmada.
  - `número de um só paciente`: comportamento atual inalterado.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** Consultar `phoneShared` só quando `patientId` existir. O filtro LGPD usa o `patientId` original; conversa e mensagem usam `null` se compartilhado. Implementar a dep comparando `normalizePhone(whatsapp) ?? normalizePhone(phone)` com `lerTudo`.
- [ ] **Step 4: Rodar `tests/messaging` e `tests/agente`.**
- [ ] **Step 5: Commit** `fix(whatsapp): número compartilhado vai para a recepção`

### Task 4: Telas com milhares de registros e histórico na ficha

**Files:**
- Modify: `src/app/(dashboard)/pacientes/page.tsx:52-61`, `src/app/(dashboard)/agenda/page.tsx:87-108`, `src/components/layout/SinoPendencias.tsx:44-58`, `src/app/(dashboard)/pacientes/[id]/page.tsx:402`, `src/components/paciente/TabOrcamentos.tsx:78-87`
- Create: `src/components/paciente/HistoricoAnterior.tsx`, `src/lib/pacientes/historicoAnterior.ts`
- Test: `tests/pacientes/historicoAnterior.test.ts`

**Interfaces:**
- Produces: `resumoHistorico(linhas: LegacyPayment[]): { pago: number; emAberto: number }`; `somarPorOrcamento(linhas: LegacyPayment[]): Record<string, number>`; `<HistoricoAnterior patientId={string} />`.

- [ ] **Step 1: Escrever testes** de `resumoHistorico` e `somarPorOrcamento`: pagos e abertos separados, sem erro de centavos (`0.1 + 0.2` soma `0.30`), orçamento nulo ignorado, lista vazia zerada.
- [ ] **Step 2: Rodar, ver falhar, implementar as funções e ver passar.**
- [ ] **Step 3: Pacientes e sino** passam a usar `lerTudo`, com ordem estável (`name`, `id`).
- [ ] **Step 4: Agenda.** Pacientes via `lerTudo`, sem o join de plano quando não usado. Consultas só do período visível com folga de um mês para cada lado, recarregando ao navegar além da folga, via `lerTudo`.
- [ ] **Step 5: Ficha.** Na aba Pagamentos, `HistoricoAnterior` só aparece se houver linhas, com o título "Histórico do sistema anterior", somente leitura, e aviso "Estes valores não fazem parte do financeiro atual". Em `TabOrcamentos`, somar o histórico ao valor cobrado de cada orçamento.
- [ ] **Step 6: Rodar `npx tsc --noEmit`, `npm run lint` e os testes.** Conferir no navegador com a conta demo.
- [ ] **Step 7: Commit** `feat(pacientes): telas para milhares de registros e histórico anterior`

### Task 5: Leitura e mapeamento do backup

**Files:**
- Create: `scripts/importar-codental/ler.mjs`, `scripts/importar-codental/mapear.mjs`
- Modify: `package.json` (devDependencies `exceljs`, `pg`)
- Test: `tests/importar-codental/mapear.test.ts`, `tests/importar-codental/ler.test.ts`

**Interfaces:**
- Produces: `lerBackup(pasta: string): Promise<Backup>` (lança erro citando planilha e coluna ausente); `mapearBackup(backup: Backup, opts: { clinicId: string, professionalId: string, agora: Date }): Plano`, com `Plano = { pacientes, convenios, procedimentos, consultas, evolucoes, tratamentos, orcamentos, historico, avisos }`, cada linha com `sourceId`.

- [ ] **Step 1: Escrever testes com dados fictícios:**
  - Status: Finalizada, Faltou, as duas canceladas (observação guarda quem cancelou), Agendada e Confirmada.
  - Consulta passada agendada → `cancelled`, nota `sem desfecho registrado no Codental`, marca presente.
  - Consulta futura agendada → `scheduled`, `imported_from: null`.
  - `05/01/2026 09:00` → `2026-01-05T12:00:00.000Z`; `end_time` soma a duração.
  - Nascimento em serial Excel `45000` → `2023-03-15`; `R$ 1.234,56` → `1234.56`.
  - Plano `Particular` ou vazio → sem convênio.
  - Tratamento `Finalizado=Sim` → `completed` com marca; `Não` → `planned` sem marca.
  - Dente `11, 12` com faces `V, O/I` → dois dentes; `---` → nenhum.
  - Valor do tratamento vem da tabela do convênio; sem coincidência → `0` e um aviso.
  - Pagamento sem data → `original_status: 'open'`; parcela `-` → `null`.
  - Planilha sem coluna obrigatória → erro com nome da planilha e da coluna, sem valores.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** Instalar as dependências com `npm i -D exceljs pg`. As planilhas usam strings inline.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** `feat(importacao): leitura e mapeamento do backup`

### Task 6: Simulação e relatório

**Files:**
- Create: `scripts/importar-codental/relatorio.mjs`, `scripts/importar-codental/cli.mjs`
- Modify: `package.json` (script `importar:codental`)
- Test: `tests/importar-codental/relatorio.test.ts`

**Interfaces:**
- Consumes: `lerBackup`, `mapearBackup`.
- Produces: `montarRelatorio(plano: Plano): Relatorio` (só contagens e totais); `node scripts/importar-codental/cli.mjs --backup <pasta> --clinica <uuid> --profissional <uuid> --saida <pasta> [--gravar] [--confirmar-clinica <uuid>]`.

- [ ] **Step 1: Escrever teste.** O relatório traz contagens por entidade, totais pago e em aberto, duplicidades e valores sem tabela. O JSON serializado não contém nome, CPF nem telefone das fixtures.
- [ ] **Step 2: Rodar, ver falhar, implementar e ver passar.** Sem `--gravar`, o CLI não abre conexão com o banco. `--saida` dentro do repositório é recusada.
- [ ] **Step 3: Rodar a simulação no backup real, fora do repositório.** Esperado: as contagens do relatório batem com as linhas das planilhas do backup.
- [ ] **Step 4: Commit** `feat(importacao): simulação com relatório`

### Task 7: Gravação do banco

**Files:**
- Create: `scripts/importar-codental/gravar.mjs`
- Modify: `scripts/importar-codental/cli.mjs`
- Test: `tests/importar-codental/gravar.test.ts`

**Interfaces:**
- Consumes: `Plano`, tabelas da Task 1.
- Produces: `gravarPlano(cliente: PgClient, plano: Plano, opts: { clinicId: string }): Promise<Resultado>`. Conexão por `IMPORT_DATABASE_URL`.

- [ ] **Step 1: Escrever testes com cliente `pg` falso:** tudo roda entre `BEGIN` e `COMMIT`; erro gera `ROLLBACK` e relança sem valores; `set_config('app.budget_system','on',true)` vem antes dos orçamentos; registro já presente em `import_links` não gera INSERT nem UPDATE; `message_settings` de `recall` e `birthday` ficam `enabled = false` na mesma transação; clínica inexistente aborta.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** em lotes, na ordem: convênios, procedimentos, pacientes, consultas, orçamentos e itens, tratamentos e dentes, evoluções, histórico, vínculos, mensagens. `--gravar` exige `--confirmar-clinica` igual a `--clinica`.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** `feat(importacao): gravação transacional e idempotente`

### Task 8: Arquivos

**Files:**
- Create: `scripts/importar-codental/arquivos.mjs`
- Modify: `scripts/importar-codental/cli.mjs`
- Test: `tests/importar-codental/arquivos.test.ts`

**Interfaces:**
- Produces: `planejarArquivos(entradas: EntradaZip[], pacientesPorNumero: Map<string,string>): ArquivoPlanejado[]`; `enviarArquivos(deps, planejados, opts): Promise<ResultadoArquivos>`; opção `--arquivos <zip>`. Bucket: `anneOdonto`. `documents.file_url` guarda o caminho, nunca URL pública.

- [ ] **Step 1: Escrever testes:** pasta `<categoria>/<numero>/<arquivo>` liga ao paciente; caminho com `..` é recusado; sem extensão recebe o tipo pelos bytes (PNG); cópia idêntica no mesmo paciente reaproveita o envio; arquivo já registrado em `import_links` é pulado; falha em um arquivo não para os demais e entra no relatório.
- [ ] **Step 2: Rodar, ver falhar, implementar e ver passar.** Ler do ZIP em streaming e enviar no máximo 4 por vez. As categorias do ZIP viram `documents.category`.
- [ ] **Step 3: Commit** `feat(importacao): envio retomável dos arquivos`

### Task 9: Anonimização e roteiro de execução

**Files:**
- Create: `scripts/importar-codental/anonimizar.mjs`, `scripts/importar-codental/README.md`
- Test: `tests/importar-codental/anonimizar.test.ts`

**Interfaces:**
- Produces: `anonimizarBackup(backup: Backup): Backup`; opção de CLI `--anonimizar --saida <pasta>`.

- [ ] **Step 1: Escrever teste:** nomes, CPFs, telefones, e-mails, carteirinhas, observações, evoluções e nascimentos mudam; o mesmo paciente recebe o mesmo substituto em todas as planilhas; números repetidos continuam repetidos; IDs, status, datas de consulta e valores são preservados.
- [ ] **Step 2: Rodar, ver falhar, implementar e ver passar.**
- [ ] **Step 3: Escrever o README** com a sequência: SQL, simulação, homologação com dados anonimizados e sem arquivos reais, conferência dos critérios de aceite, Supabase Pro, backup validado, export final, simulação, gravação e arquivos. Sem nomes de clínica.
- [ ] **Step 4: Rodar `npm test`, `npx tsc --noEmit` e `npm run lint`.**
- [ ] **Step 5: Commit** `docs(importacao): anonimização e roteiro de execução`
