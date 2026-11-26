# Cancelado pelo paciente ou pelo dentista — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar quem cancelou cada consulta (paciente ou dentista), escolher isso na agenda, gravar sozinho pelo WhatsApp e separar nos indicadores e na aba Consultas.

**Architecture:** A situação continua `cancelled`; `appointments` ganha `cancelled_by` (`'patient' | 'professional' | null`), e um gatilho no banco apaga o campo quando a situação deixa de ser `cancelled`. Um módulo sem tela (`src/lib/agenda/situacao.ts`) traduz situação + quem cancelou em valor de lista, rótulo e opções; a agenda, a aba Consultas e os indicadores usam esse módulo.

**Tech Stack:** Next.js 16, React 19, Supabase (SQL à mão), Tailwind v4 com os tokens do projeto, Vitest, Playwright para a conferência no navegador.

**Spec:** `docs/superpowers/specs/2026-11-26-cancelado-por-design.md`

## Global Constraints

- Rótulos: "Cancelado pelo paciente", "Cancelado pelo dentista"; cancelamento antigo (sem `cancelled_by`): "Cancelado". Mesma cor de hoje (`APPOINTMENT_STATUS_COLORS.cancelled`).
- Valores gravados: `'patient'` e `'professional'`.
- Nada que hoje trata `cancelled` como horário livre muda (conferência de horário, agente, lembretes, aviso de desmarcação).
- SQL novo em `supabase/2026-11-26-cancelado-por.sql`, que pode rodar mais de uma vez, com o mesmo conteúdo em `supabase/schema.sql`. O usuário roda o SQL à mão na homologação (antes da conferência no navegador) e na produção (antes do merge na main).
- Fora do escopo: motivo do cancelamento; preencher os cancelamentos antigos.
- Rodar Vitest pelo PowerShell.

## Review Focus

- Consulta antiga cancelada (`cancelled_by` nulo) aberta no popup ou em "Editar consulta": a lista mostra "Cancelado" selecionado; salvar o modal sem mexer na situação mantém o campo nulo.
- Trocar "Cancelado pelo paciente" → "Concluído" → "Cancelado pelo dentista": o campo some e volta com o valor novo (gatilho + o que a tela grava).
- Remarcação pelo agente (`book_whatsapp_appointment` com `p_replace_id`) grava `'patient'` na consulta antiga.
- SQL rodado duas vezes não dá erro.
- Indicadores com cancelamentos antigos misturados: o total de canceladas continua igual a hoje; as partes paciente + dentista podem somar menos que o total.

---

### Task 1: Banco — coluna, gatilho e remarcação pelo agente

**Files:**
- Create: `supabase/2026-11-26-cancelado-por.sql`
- Modify: `supabase/schema.sql` (tabela `appointments` ~linha 66; `book_whatsapp_appointment` ~linha 1454, o `UPDATE appointments SET status = 'cancelled'` ~linha 1494)
- Test: `tests/supabase/cancelado-por.test.ts`

**Interfaces:**
- Produces: coluna `appointments.cancelled_by TEXT` com `CHECK (cancelled_by IN ('patient','professional'))`; gatilho `appointments_cancelled_by_clear` (BEFORE INSERT OR UPDATE) que põe `NEW.cancelled_by := NULL` quando `NEW.status <> 'cancelled'`.

- [ ] **Step 1: Teste que falha** em `tests/supabase/cancelado-por.test.ts`, no estilo de `tests/supabase/importacao-codental.test.ts` (`describe.each(['2026-11-26-cancelado-por.sql', 'schema.sql'])`):
  - `cria a coluna cancelled_by com os dois valores`: contém `ADD COLUMN IF NOT EXISTS cancelled_by TEXT` e `CHECK (cancelled_by IN ('patient','professional'))`.
  - `apaga quem cancelou quando a consulta deixa de estar cancelada`: contém `NEW.status <> 'cancelled'`, `NEW.cancelled_by := NULL` e `CREATE TRIGGER appointments_cancelled_by_clear`, precedido de `DROP TRIGGER IF EXISTS appointments_cancelled_by_clear ON appointments;`.
  - `remarcação pelo agente grava o paciente`: casa `/UPDATE appointments SET status = 'cancelled', cancelled_by = 'patient'/`.
- [ ] **Step 2: Rodar e ver falhar.** `npx vitest run tests/supabase/cancelado-por.test.ts` → FAIL (arquivo não existe).
- [ ] **Step 3: Escrever o SQL.** Cabeçalho no padrão de `supabase/2026-11-22-importacao-codental.sql` (o que acrescenta, "Rode depois de supabase/2026-11-22-importacao-codental.sql", como aplicar, pode rodar mais de uma vez). Conteúdo: a coluna; a constraint com `DROP CONSTRAINT IF EXISTS appointments_cancelled_by_check` antes do `ADD CONSTRAINT`; a função do gatilho (`CREATE OR REPLACE FUNCTION public.appointments_cancelled_by_clear() RETURNS trigger LANGUAGE plpgsql`); `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER ... BEFORE INSERT OR UPDATE ON appointments FOR EACH ROW`; e `CREATE OR REPLACE` de `public.book_whatsapp_appointment` copiado inteiro de `schema.sql`, trocando só o `UPDATE` da consulta substituída para `SET status = 'cancelled', cancelled_by = 'patient'`. Em `schema.sql`: coluna e constraint na criação da tabela (ou logo depois, com o mesmo texto do teste), gatilho junto, e a mesma troca no `UPDATE` da função.
- [ ] **Step 4: Rodar e ver passar.** Mesmo comando → PASS; `npx vitest run tests/supabase` → tudo passando.
- [ ] **Step 5: Commit** — `feat(agenda): coluna de quem cancelou a consulta`.

### Task 2: Situação da consulta na agenda e no WhatsApp

**Files:**
- Create: `src/lib/agenda/situacao.ts`
- Modify: `src/types/index.ts` (`Appointment` ~linha 122), `src/components/agenda/PopoverConsulta.tsx` (~linhas 27–45 e 105–115), `src/components/agenda/ModalEditarConsulta.tsx` (`statusOptions` ~36–44, estado ~55/69, `update` ~86–94, `<select>` ~211–219), `src/lib/messaging/incoming.ts` (`setAppointmentStatus` ~387), `src/lib/agente/agendamento/repo.ts` (`desmarcar` ~112)
- Test: `tests/agenda/situacao.test.ts`

**Interfaces:**
- Produces, em `@/types`: `export type CanceladoPor = 'patient' | 'professional'` e `cancelled_by?: CanceladoPor | null` em `Appointment`.
- Produces, em `src/lib/agenda/situacao.ts`:
  ```ts
  export type ValorSituacao = AppointmentStatus | 'cancelled:patient' | 'cancelled:professional'
  export function valorDaSituacao(status: AppointmentStatus, cancelledBy?: CanceladoPor | null): ValorSituacao
  export function lerSituacao(v: ValorSituacao): { status: AppointmentStatus; cancelled_by: CanceladoPor | null }
  export function rotuloSituacao(status: AppointmentStatus, cancelledBy?: CanceladoPor | null): string
  export function opcoesSituacao(atual: ValorSituacao): { value: ValorSituacao; label: string }[]
  ```

- [ ] **Step 1: Testes que falham** em `tests/agenda/situacao.test.ts`:
  - `valorDaSituacao`: `('cancelled','patient')` → `'cancelled:patient'`; `('cancelled', null)` → `'cancelled'`; `('confirmed','patient')` → `'confirmed'`.
  - `lerSituacao`: `'cancelled:professional'` → `{ status: 'cancelled', cancelled_by: 'professional' }`; `'completed'` → `{ status: 'completed', cancelled_by: null }`; `'cancelled'` → `{ status: 'cancelled', cancelled_by: null }`.
  - `rotuloSituacao`: paciente → `'Cancelado pelo paciente'`, dentista → `'Cancelado pelo dentista'`, nulo → `'Cancelado'`, `('no_show')` → `'Faltou'`.
  - `opcoesSituacao('confirmed')` → labels `['Agendado','Confirmado','Aguardando','Em atendimento','Concluído','Cancelado pelo paciente','Cancelado pelo dentista','Faltou']`.
  - `opcoesSituacao('cancelled')` inclui `{ value: 'cancelled', label: 'Cancelado' }` logo antes de "Cancelado pelo paciente"; `opcoesSituacao('cancelled:patient')` não inclui `'cancelled'`.
- [ ] **Step 2: Rodar e ver falhar.** `npx vitest run tests/agenda/situacao.test.ts` → FAIL (módulo não existe).
- [ ] **Step 3: Implementar `situacao.ts`** com os rótulos de `APPOINTMENT_STATUS_LABELS` para o resto.
- [ ] **Step 4: Rodar e ver passar.** Mesmo comando → PASS.
- [ ] **Step 5: Usar na tela e no WhatsApp.**
  - Popup: o estado guarda `ValorSituacao` (`valorDaSituacao(apt.status, apt.cancelled_by)`); a lista usa `opcoesSituacao`; ao mudar, grava `lerSituacao(v)` (`status` e `cancelled_by`) no mesmo `update`. A cor continua vindo de `status`.
  - "Editar consulta": `statusOptions` sai; a lista usa `opcoesSituacao`, e o `update` grava `status` e `cancelled_by` de `lerSituacao`.
  - `incoming.ts` `setAppointmentStatus`: quando `status === 'cancelled'`, o `update` grava também `cancelled_by: 'patient'`. `repo.ts` `desmarcar`: `update({ status: 'cancelled', cancelled_by: 'patient' })`.
- [ ] **Step 6: Tipos, lint e testes.** `npx tsc --noEmit -p .`, `npx eslint` nos arquivos tocados, `npx vitest run tests/agenda tests/messaging tests/agente` → sem erros e passando.
- [ ] **Step 7: Commit** — `feat(agenda): escolher se o paciente ou o dentista cancelou`.

### Task 3: Indicadores separam quem cancelou

**Files:**
- Modify: `src/lib/indicadores/agenda.ts` (`ConsultaIn`, `Contagem`, `contar`), `src/lib/indicadores/repo.ts` (`select` ~linha 49), `src/components/relatorios/BlocoAgenda.tsx`
- Test: `tests/indicadores/agenda.test.ts`

**Interfaces:**
- Consumes: `CanceladoPor` de `@/types`.
- Produces: `ConsultaIn.cancelled_by?: CanceladoPor | null`; `Contagem` ganha `canceladasPaciente: number` e `canceladasDentista: number` (`canceladas` continua sendo o total).

- [ ] **Step 1: Teste que falha** em `tests/indicadores/agenda.test.ts`: `separa canceladas pelo paciente e pelo dentista`: 2 canceladas `'patient'`, 1 `'professional'`, 1 sem `cancelled_by` → `toMatchObject({ canceladas: 4, canceladasPaciente: 2, canceladasDentista: 1 })`; e o mesmo em `porDentista` para um dentista com 1 `'professional'`.
- [ ] **Step 2: Rodar e ver falhar.** `npx vitest run tests/indicadores/agenda.test.ts` → FAIL.
- [ ] **Step 3: Implementar** a contagem e acrescentar `cancelled_by` ao `select` do repo.
- [ ] **Step 4: Rodar e ver passar.** `npx vitest run tests/indicadores` → PASS.
- [ ] **Step 5: Tela.** Em `BlocoAgenda`, depois de "Canceladas: N (x%)", as partes que não forem zero: "N pelo paciente", "N pelo dentista". Na tabela por dentista, duas colunas novas logo depois de "Canceladas": "Pelo paciente" e "Pelo dentista" (ajustar o `colSpan` da linha vazia).
- [ ] **Step 6: Commit** — `feat(indicadores): canceladas pelo paciente e pelo dentista`.

### Task 4: Aba Consultas mostra quem cancelou

**Files:**
- Modify: `src/lib/pacientes/historicoConsultas.ts` (`ConsultaHist`, `ResumoConsultas`, `resumir`), `src/components/paciente/TabConsultas.tsx` (etiqueta ~linha 90; `Resumo` ~linha 53)
- Test: `tests/pacientes/historicoConsultas.test.ts`

**Interfaces:**
- Consumes: `rotuloSituacao` (Task 2), `CanceladoPor`.
- Produces: `ConsultaHist.cancelled_by?: CanceladoPor | null`; `ResumoConsultas` ganha `canceladasPaciente` e `canceladasDentista`.

- [ ] **Step 1: Teste que falha**: no teste `resume realizadas, faltas, canceladas e dentistas`, a consulta `'6'` passa a ter `cancelled_by: 'patient'` e entra uma `'7'` cancelada sem `cancelled_by` → resumo com `canceladas: 2, canceladasPaciente: 1, canceladasDentista: 0`; atualizar também o teste `sem consultas` com os dois zeros.
- [ ] **Step 2: Rodar e ver falhar.** `npx vitest run tests/pacientes/historicoConsultas.test.ts` → FAIL.
- [ ] **Step 3: Implementar** no `resumir`.
- [ ] **Step 4: Rodar e ver passar.** Mesmo comando → PASS.
- [ ] **Step 5: Tela.** Etiqueta da linha com `rotuloSituacao(x.status, x.cancelled_by)`. No resumo, no lugar de "N canceladas": "N cancelada(s) pelo paciente", "N pelo dentista" e, para o que sobrar sem informação, "N cancelada(s)"; só as partes que não forem zero.
- [ ] **Step 6: Commit** — `feat(pacientes): aba Consultas mostra quem cancelou`.

### Task 5: Conferência no navegador e suíte completa

- [ ] **Step 1: SQL na homologação.** Pedir ao usuário para rodar `supabase/2026-11-26-cancelado-por.sql` no projeto de homologação (é o banco do `npm run dev`). Parar até ele confirmar.
- [ ] **Step 2: Navegador** (conta demo, 1366px e 390px): no popup, trocar uma consulta para "Cancelado pelo paciente", depois "Concluído", depois "Cancelado pelo dentista", conferindo no banco o `cancelled_by` a cada troca (e devolver a situação original no fim); em "Editar consulta", conferir a lista e salvar; abrir Relatórios/Indicadores e a aba Consultas do paciente e ver as separações. Sem erros de página.
- [ ] **Step 3: Suíte e entrega.** PowerShell `npx vitest run` → tudo passando; `npx tsc --noEmit -p .`; push da `feat/cancelado-por`.
