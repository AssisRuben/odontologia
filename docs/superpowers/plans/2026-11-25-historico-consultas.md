# Aba "Consultas" no prontuário — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nova aba "Consultas" no prontuário com resumo, próximas consultas e histórico por ano, com a evolução de cada consulta abrindo no próprio item.

**Architecture:** A regra fica num módulo sem tela (`src/lib/pacientes/historicoConsultas.ts`), testado com Vitest. A aba é um componente cliente (`TabConsultas`) que recebe as consultas e evoluções que a página do paciente já carrega. A página só ganha a aba e passa a buscar `appointment_id` nas evoluções.

**Tech Stack:** Next.js 16 (App Router, client components), React 19, Tailwind v4 com os tokens do projeto, date-fns com `ptBR`, Vitest, Playwright para a conferência no navegador.

**Spec:** `docs/superpowers/specs/2026-11-25-historico-consultas-design.md`

## Global Constraints

- Sem mudança no banco; usar só os dados que `src/app/(dashboard)/pacientes/[id]/page.tsx` já carrega, mais `appointment_id` nas evoluções.
- Aba com rótulo **Consultas**, id `consultas`, logo depois de **Visão Geral**; abre por `?aba=consultas`.
- Cores da situação: `APPOINTMENT_STATUS_COLORS` e rótulos `APPOINTMENT_STATUS_LABELS` de `@/types` (as mesmas da agenda).
- Textos em português, sem caixa alta em rótulos. Sem consultas: "Nenhuma consulta registrada. As consultas marcadas na agenda aparecem aqui."
- Fora do escopo: filtros, busca, editar consulta/situação, lançar evolução.
- Rodar Vitest pelo PowerShell (no Git Bash o caminho `c:/` em minúsculas quebra o Vitest).

## Review Focus

- Consulta passada que ficou "Agendado" (ninguém atualizou): vai para o histórico com a etiqueta Agendado, não para Próximas.
- Duas consultas no mesmo dia e uma evolução sem consulta ligada: a evolução fica com a primeira consulta do dia, não aparece duas vezes.
- Evolução ligada a uma consulta que não está na lista (outro paciente/apagada): não some nem quebra; segue a regra do mesmo dia.
- Consulta sem dentista carregado (`professional` nulo) ou sem procedimento: mostra "Dentista" / "—", sem erro.
- Consulta às 23h30 ou 00h30: o ano e o dia usados são os do horário local, como na agenda.

---

### Task 1: Regra do histórico

**Files:**
- Create: `src/lib/pacientes/historicoConsultas.ts`
- Test: `tests/pacientes/historicoConsultas.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ConsultaHist {
    id: string; start_time: string; end_time: string; status: AppointmentStatus
    procedure?: string | null; professional?: { name: string; color?: string | null } | null
  }
  export interface EvolucaoHist { id: string; date: string /* yyyy-MM-dd */; appointment_id: string | null }
  export interface ResumoConsultas {
    realizadas: number            // status 'completed'
    primeira: string | null       // start_time da primeira consulta 'completed'
    faltas: number                // 'no_show'
    canceladas: number            // 'cancelled'
    dentistas: string[]           // nomes distintos nas consultas 'completed', do que mais atendeu ao que menos
  }
  export function montarHistorico<C extends ConsultaHist, E extends EvolucaoHist>(
    consultas: C[], evolucoes: E[], agora: Date,
  ): {
    resumo: ResumoConsultas
    proximas: C[]                              // start_time >= agora e status fora de cancelled/no_show, crescente
    anos: { ano: number; consultas: C[] }[]    // o resto, decrescente, ano local de start_time, anos decrescentes
    evolucoesDa: Record<string, E[]>           // id da consulta -> evoluções
  }
  ```

- [ ] **Step 1: Escrever os testes que falham** em `tests/pacientes/historicoConsultas.test.ts` (horários no meio do dia, sem `Z`, para não depender de fuso), com fábrica `c(id, start, status, prof?)` e `e(id, date, appointment_id)`:
  - `separa próximas e histórico`: agora `2026-11-25T12:00:00`; consultas `a` 2026-12-02 scheduled, `b` 2026-11-30 confirmed, `x` 2026-12-05 cancelled, `d` 2026-11-18 completed, `v` 2026-10-01 scheduled (passada, nunca atualizada) → `proximas` ids `['b','a']`; histórico achatado `['x','d','v']`.
  - `agrupa por ano, do mais recente`: consultas em 2026-03-10, 2025-08-01, 2026-11-18, 2024-01-05 → `anos.map(a => a.ano)` = `[2026, 2025, 2024]` e 2026 com ids em ordem `['2026-11-18','2026-03-10']`.
  - `ano pelo horário local`: consulta `2025-12-31T23:30:00` fica em `ano: 2025`.
  - `resume realizadas, faltas, canceladas e dentistas`: 3 completed (Ana, Ana, Paulo; a mais antiga em 2024-03-04), 2 no_show, 1 cancelled → `{ realizadas: 3, primeira: '2024-03-04T10:00:00', faltas: 2, canceladas: 1, dentistas: ['Ana','Paulo'] }`.
  - `sem consultas`: `montarHistorico([], [], agora)` → `resumo` com zeros, `primeira: null`, `dentistas: []`, `proximas: []`, `anos: []`.
  - `liga evolução pela consulta gravada`: `e('e1','2026-11-18','d')` → `evolucoesDa.d` ids `['e1']`.
  - `sem ligação, vale o mesmo dia e a primeira consulta do dia`: consultas `m` 2026-11-10T09:00 e `t` 2026-11-10T15:00, evolução `e2` 2026-11-10 com `appointment_id: null` → `evolucoesDa.m` = `['e2']`, `evolucoesDa.t` indefinido.
  - `mesmo dia não rouba consulta que já tem evolução ligada`: `m` tem `e1` ligada; `e2` sem ligação no mesmo dia vai para `t`.
  - `ligação para consulta fora da lista cai na regra do dia`: `e3` com `appointment_id: 'sumiu'` e data de `d` → `evolucoesDa.d` contém `e3`.
  - `evolução sem consulta no dia fica fora`: `e4` em 2020-01-01 → não aparece em nenhum `evolucoesDa`.

- [ ] **Step 2: Rodar e ver falhar.** PowerShell: `npx vitest run tests/pacientes/historicoConsultas.test.ts` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar `montarHistorico` em `src/lib/pacientes/historicoConsultas.ts`.** Datas locais com `parseISO` + `format(..., 'yyyy-MM-dd')` / `getFullYear()`. Ligação em duas passadas: primeiro todas as evoluções com `appointment_id` de uma consulta da lista; depois as restantes, por dia, para a primeira consulta do dia (ordem de `start_time`) que ainda não tenha evolução — se todas já têm, a primeira do dia.

- [ ] **Step 4: Rodar e ver passar.** Mesmo comando → PASS (10 testes).

- [ ] **Step 5: Commit** — `feat(pacientes): regra do histórico de consultas`.

### Task 2: Aba Consultas no prontuário

**Files:**
- Create: `src/components/paciente/TabConsultas.tsx`
- Modify: `src/app/(dashboard)/pacientes/[id]/page.tsx` (tipo `Tab`/`TABS` ~linhas 48–59, tipo `PatientEvolution` ~61–68, busca de evoluções ~118–122, conteúdo das abas ~295+)

**Interfaces:**
- Consumes: `montarHistorico`, `ConsultaHist`, `EvolucaoHist` da Task 1.
- Produces: `export function TabConsultas({ consultas, evolucoes }: { consultas: Appointment[]; evolucoes: (EvolucaoHist & { description: string; professional?: { name: string } | null })[] })`.

- [ ] **Step 1: Página.** Acrescentar `'consultas'` ao tipo `Tab` e `{ id: 'consultas', label: 'Consultas' }` logo depois de Visão Geral; `appointment_id: string | null` em `PatientEvolution` e no `select` das evoluções; renderizar `{activeTab === 'consultas' && <TabConsultas consultas={appointments} evolucoes={evolutions} />}`.

- [ ] **Step 2: Componente `TabConsultas`.** Chama `montarHistorico(consultas, evolucoes, new Date())` (em `useMemo`). Monta:
  - Faixa de resumo em uma linha (quebra no celular): "N consultas realizadas", "desde mmm/aaaa", "N faltas", "N canceladas" (singular quando 1), nomes dos dentistas; itens com zero não aparecem; some inteira se não houver consultas.
  - Seções "Próximas" (só se houver) e uma por ano, título discreto com régua.
  - Linha: data `dd/MM/yyyy` + dia da semana curto, `HH:mm–HH:mm`, bolinha na cor do dentista (`professional.color`, padrão `#173B47`) + nome (padrão "Dentista"), procedimento (padrão "—"), etiqueta da situação com fundo `cor + '1A'` e texto na cor. No celular: duas linhas (data/hora/situação; dentista/procedimento).
  - Se `evolucoesDa[id]` existir: botão "Evolução" com `aria-expanded`; aberto, mostra cada texto (`whitespace-pre-line`) com o nome de quem registrou.
  - Lista vazia: card com o texto de vazio das Global Constraints.

- [ ] **Step 3: Tipos e lint.** `npx tsc --noEmit -p .` sem erros; `npx eslint` nos dois arquivos sem problemas novos.

- [ ] **Step 4: Conferir no navegador** (servidor local, conta demo `MANUAL_EMAIL`/`MANUAL_SENHA`): abrir um paciente com consultas em `/pacientes/<id>?aba=consultas` em 1366px e 390px; conferir resumo, Próximas, grupos por ano, etiquetas, abrir/fechar uma evolução, e um paciente sem consultas mostrando o texto de vazio. Sem erros de página.

- [ ] **Step 5: Suíte completa e commit.** PowerShell `npx vitest run` → tudo passando; commit `feat(pacientes): aba Consultas com histórico e evoluções` e push na `fix/menu-estoque`.
